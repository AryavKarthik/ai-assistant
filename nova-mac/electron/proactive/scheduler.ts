import { Notification } from "electron";
import {
  IpcChannel,
  type AlertPrefs,
  type ProactivePrefs,
  type ProactiveSpeakEvent,
  DEFAULT_PROACTIVE_PREFS,
} from "@shared/types";
import { isQuietNow } from "./quiet-hours";
import { getAlertPrefs } from "./alert-prefs";
import { wasAnnounced, markAnnounced } from "./announce-store";
import { dueLoops, markLoopRan } from "./loops-store";

const TICK_MS = 30_000;
/** Don't announce an alert whose fire moment is further in the past than this
 *  (Mac was asleep / app was closed) — a 40-minute-late "in 10 minutes" heads-up
 *  is worse than none. Due-time (lead 0) reminders get a longer grace below. */
const STALE_ALERT_MS = 5 * 60_000;
const STALE_DUE_REMINDER_MS = 30 * 60_000;
/** How rarely to re-fetch prefs from Supabase between explicit refreshes. */
const PREFS_TTL_MS = 5 * 60_000;

export interface ProactiveHost {
  activateOrb(): void;
  broadcast(channel: IpcChannel, payload: unknown): void;
}

interface Announcement {
  key: string;
  kind: ProactiveSpeakEvent["kind"];
  noticeText: string;
  speechText: string;
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function leadPhrase(leadMin: number): string {
  if (leadMin <= 0) return "now";
  if (leadMin === 1) return "in a minute";
  if (leadMin % 60 === 0) {
    const h = leadMin / 60;
    return h === 1 ? "in an hour" : `in ${h} hours`;
  }
  return `in ${leadMin} minutes`;
}

export class ProactiveScheduler {
  private host: ProactiveHost;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private prefs: { proactive: ProactivePrefs; alerts: AlertPrefs; fetchedAt: number } | null = null;
  private loopRunning = false;

  constructor(host: ProactiveHost) {
    this.host = host;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // First look shortly after boot, once auth/session had a moment to restore.
    setTimeout(() => void this.tick(), 8_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Called by main after PrefsSet so Settings changes apply immediately. */
  refreshPrefs(): void {
    this.prefs = null;
  }

  /** Timer completions route through here so they share the DND/speech rules.
   *  Only speech is handled — the notification + orb notice already come from
   *  the TimerFired path in main.ts. */
  async announceTimerDone(label: string): Promise<void> {
    const { alerts, proactive } = await this.loadPrefs();
    if (!alerts.speakTimerDone || !alerts.voiceAnnouncementsEnabled) return;
    if (this.isQuiet(proactive, alerts)) return;
    const fallback = label ? `Timer's done — ${label}.` : "Your timer is up.";
    const { generateSpokenAnnouncement } = await import("./announce-text");
    this.host.broadcast(IpcChannel.ProactiveSpeak, {
      id: `timer-${Date.now()}`,
      kind: "timer",
      noticeText: "",
      speechText: await generateSpokenAnnouncement("timer", fallback, fallback),
    } satisfies ProactiveSpeakEvent);
  }

  private isQuiet(proactive: ProactivePrefs, alerts: AlertPrefs): boolean {
    return (
      alerts.quietHoursEnabled &&
      isQuietNow(new Date(), proactive.quietHoursStart, proactive.quietHoursEnd)
    );
  }

  private async loadPrefs(): Promise<{ proactive: ProactivePrefs; alerts: AlertPrefs }> {
    if (this.prefs && Date.now() - this.prefs.fetchedAt < PREFS_TTL_MS) return this.prefs;
    let proactive = DEFAULT_PROACTIVE_PREFS;
    try {
      const mod = await import("../voice/save-preferences");
      proactive = (await mod.getAllPreferences()).proactive;
    } catch {
      // signed out / offline — defaults are fine, alerts gate on sign-in below
    }
    this.prefs = { proactive, alerts: getAlertPrefs(), fetchedAt: Date.now() };
    return this.prefs;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Signed out → nothing to do (every source below needs the user).
      const { getUserId } = await import("../memory/client");
      let userId: string;
      try {
        userId = await getUserId();
      } catch {
        return;
      }

      const { proactive, alerts } = await this.loadPrefs();
      const announcements: Announcement[] = [];

      if (proactive.proactiveMode !== "off") {
        announcements.push(...(await this.collectReminderAlerts(alerts)));
      }
      if (proactive.proactiveMode === "full" && alerts.calendarLeadMinutes.length > 0) {
        announcements.push(...(await this.collectCalendarAlerts(userId, alerts)));
      }

      const quiet = this.isQuiet(proactive, alerts);
      const willSpeak = alerts.voiceAnnouncementsEnabled && !quiet;
      for (const a of announcements) {
        markAnnounced(a.key);
        // Rewrite the spoken line in Nova's actual voice (template = fallback)
        // so announcements don't sound like a different, robotic assistant.
        if (willSpeak && a.kind !== "loop") {
          const { generateSpokenAnnouncement } = await import("./announce-text");
          a.speechText = await generateSpokenAnnouncement(a.kind, a.speechText, a.speechText);
        }
        this.deliver(a, quiet, alerts);
      }

      // Agent loops run regardless of proactiveMode — the user explicitly
      // created each one — but their spoken results still respect DND.
      await this.runDueLoops(quiet, alerts);
    } catch (err) {
      console.error("[proactive] tick failed:", err instanceof Error ? err.message : err);
    } finally {
      this.ticking = false;
    }
  }

  private deliver(a: Announcement, quiet: boolean, alerts: AlertPrefs): void {
    if (Notification.isSupported() && a.noticeText) {
      new Notification({ title: "Nova", body: a.noticeText, silent: quiet }).show();
    }
    const speak = alerts.voiceAnnouncementsEnabled && !quiet;
    if (!speak && !a.noticeText) return;
    if (speak) this.host.activateOrb();
    this.host.broadcast(IpcChannel.ProactiveSpeak, {
      id: a.key,
      kind: a.kind,
      noticeText: a.noticeText,
      speechText: speak ? a.speechText : "",
    } satisfies ProactiveSpeakEvent);
  }

  private async collectReminderAlerts(alerts: AlertPrefs): Promise<Announcement[]> {
    if (alerts.reminderLeadMinutes.length === 0) return [];
    const out: Announcement[] = [];
    try {
      const { listRemindersIpc } = await import("../memory/reminders");
      const reminders = await listRemindersIpc("pending");
      const now = Date.now();
      for (const r of reminders) {
        if (!r.dueAt) continue;
        const due = Date.parse(r.dueAt);
        if (Number.isNaN(due)) continue;
        for (const lead of alerts.reminderLeadMinutes) {
          const fireAt = due - lead * 60_000;
          if (fireAt > now) continue;
          const staleMs = lead === 0 ? STALE_DUE_REMINDER_MS : STALE_ALERT_MS;
          if (now - fireAt > staleMs) continue;
          const key = `reminder:${r.id}:${lead}`;
          if (wasAnnounced(key)) continue;
          const phrase = leadPhrase(lead);
          out.push({
            key,
            kind: "reminder",
            noticeText: lead === 0 ? `Reminder: ${r.title}` : `Reminder ${phrase}: ${r.title}`,
            speechText:
              lead === 0
                ? `Hey — reminder: ${r.title}.`
                : `Heads up — ${r.title}, ${phrase}.`,
          });
          break; // one announcement per reminder per tick (largest lead first)
        }
      }
    } catch (err) {
      console.warn("[proactive] reminders check failed:", err instanceof Error ? err.message : err);
    }
    return out;
  }

  private async collectCalendarAlerts(userId: string, alerts: AlertPrefs): Promise<Announcement[]> {
    const out: Announcement[] = [];
    try {
      const { listCalendarEvents } = await import("../google/calendar");
      const now = Date.now();
      const maxLead = Math.max(...alerts.calendarLeadMinutes);
      const result = await listCalendarEvents(userId, {
        timeMin: new Date(now - 60_000).toISOString(),
        timeMax: new Date(now + (maxLead + 5) * 60_000).toISOString(),
        maxResults: 15,
      });
      if ("error" in result) return out; // calendar not connected — silently skip
      for (const event of result.events) {
        // All-day events (date only, no time) aren't "starting in N minutes".
        if (!event.start.includes("T")) continue;
        const start = Date.parse(event.start);
        if (Number.isNaN(start)) continue;
        for (const lead of alerts.calendarLeadMinutes) {
          const fireAt = start - lead * 60_000;
          if (fireAt > now || now - fireAt > STALE_ALERT_MS) continue;
          const key = `calendar:${event.id}:${lead}`;
          if (wasAnnounced(key)) continue;
          const timeLabel = formatClockTime(new Date(start));
          out.push({
            key,
            kind: "calendar",
            noticeText: `${event.summary} — ${timeLabel}`,
            speechText: `Heads up — ${event.summary} ${leadPhrase(lead)}, at ${timeLabel}.`,
          });
          break;
        }
      }
    } catch (err) {
      console.warn("[proactive] calendar check failed:", err instanceof Error ? err.message : err);
    }
    return out;
  }

  private async runDueLoops(quiet: boolean, alerts: AlertPrefs): Promise<void> {
    if (this.loopRunning) return; // one loop turn at a time
    const { run, stale } = dueLoops();
    for (const loop of stale) {
      // Missed its slot by too much (asleep/closed) — skip this occurrence.
      markLoopRan(loop.id, "Skipped — the scheduled time passed while Nova wasn't running.");
    }
    const loop = run[0];
    if (!loop) return;
    this.loopRunning = true;
    try {
      const { runAgentLoop } = await import("./loop-runner");
      let result: string;
      let failed = false;
      try {
        result = await runAgentLoop(loop);
      } catch (err) {
        failed = true;
        result = `Failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
      markLoopRan(loop.id, result);
      this.deliver(
        {
          key: `loop-run:${loop.id}:${Date.now()}`,
          kind: "loop",
          noticeText: `${loop.name}: ${result}`,
          speechText: failed
            ? `Your "${loop.name}" task failed — ${result.replace(/^Failed:\s*/, "")}`
            : result,
        },
        quiet || !loop.speakResult,
        alerts,
      );
    } finally {
      this.loopRunning = false;
    }
  }
}

let scheduler: ProactiveScheduler | null = null;

export function initProactiveScheduler(host: ProactiveHost): ProactiveScheduler {
  scheduler = new ProactiveScheduler(host);
  scheduler.start();
  return scheduler;
}

export function getProactiveScheduler(): ProactiveScheduler | null {
  return scheduler;
}
