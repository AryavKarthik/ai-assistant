import { execFile } from "node:child_process";

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

const osascript = (script: string) => run("/usr/bin/osascript", ["-e", script]);

// ─── Volume ───────────────────────────────────────────────────────────────────

export async function setSystemVolume(options: {
  level?: number; // 0–100
  muted?: boolean;
}): Promise<{ level?: number; muted?: boolean; verified: boolean }> {
  if (options.muted !== undefined) {
    await osascript(`set volume output muted ${options.muted}`);
  }
  if (options.level !== undefined) {
    const level = Math.round(Math.max(0, Math.min(100, options.level)));
    await osascript(`set volume output volume ${level}`);
    // Read back and confirm the OS actually applied it — "success" from
    // osascript alone has let the assistant claim changes that never landed.
    const after = await getSystemVolume();
    if (Math.abs(after.level - level) > 2) {
      throw new Error(
        `Volume did not change: asked for ${level} but the system reports ${after.level}. ` +
          "The output device may not support software volume control.",
      );
    }
    return { level: after.level, muted: after.muted, verified: true };
  }
  const after = await getSystemVolume();
  return { muted: after.muted, verified: true };
}

export async function getSystemVolume(): Promise<{ level: number; muted: boolean }> {
  const out = await osascript(
    'get volume settings',
  );
  // e.g. "output volume:44, input volume:71, alert volume:100, output muted:false"
  const level = Number(/output volume:(\d+)/.exec(out)?.[1] ?? "0");
  const muted = /output muted:true/.test(out);
  return { level, muted };
}

// ─── Brightness ───────────────────────────────────────────────────────────────

// macOS has no scriptable absolute brightness API. Strategy: use the `brightness`
// CLI (brew install brightness) when present; otherwise fall back to simulating
// the F1/F2 brightness keys via System Events (16 hardware steps, needs the
// Accessibility permission macOS prompts for on first use).
const BRIGHTNESS_STEPS = 16;

async function brightnessCliPath(): Promise<string | null> {
  for (const p of ["/opt/homebrew/bin/brightness", "/usr/local/bin/brightness"]) {
    try {
      await run("/bin/test", ["-x", p]);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Rewrites the opaque System Events keystroke-permission failure into an
 *  actionable message so the assistant can tell the user how to fix it
 *  instead of pretending the change happened. */
function explainBrightnessError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not allowed to send keystrokes|1002/.test(msg)) {
    return new Error(
      "Brightness change FAILED: macOS blocked the simulated brightness keys. " +
        "Fix: either grant Nova the Accessibility permission (System Settings → " +
        "Privacy & Security → Accessibility) or install the brightness CLI " +
        "(`brew install brightness`), then try again.",
    );
  }
  return new Error(`Brightness change FAILED: ${msg}`);
}

export async function setScreenBrightness(level: number): Promise<{ level: number; method: string }> {
  const clamped = Math.max(0, Math.min(1, level));
  const cli = await brightnessCliPath();
  if (cli) {
    await run(cli, [clamped.toFixed(2)]);
    return { level: clamped, method: "brightness-cli" };
  }
  // Fallback: drive to zero, then step up to the target.
  const upPresses = Math.round(clamped * BRIGHTNESS_STEPS);
  const script = [
    "tell application \"System Events\"",
    ...Array.from({ length: BRIGHTNESS_STEPS }, () => "key code 145"),
    ...Array.from({ length: upPresses }, () => "key code 144"),
    "end tell",
  ].join("\n");
  try {
    await osascript(script);
  } catch (err) {
    throw explainBrightnessError(err);
  }
  return { level: clamped, method: "key-simulation" };
}

export async function nudgeScreenBrightness(direction: "up" | "down", steps = 2): Promise<{ method: string }> {
  const cli = await brightnessCliPath();
  const n = Math.max(1, Math.min(BRIGHTNESS_STEPS, Math.round(steps)));
  if (cli) {
    const out = await run(cli, ["-l"]);
    const current = Number(/brightness (\d*\.?\d+)/.exec(out)?.[1] ?? "0.5");
    const next = Math.max(0, Math.min(1, current + (direction === "up" ? 1 : -1) * (n / BRIGHTNESS_STEPS)));
    await run(cli, [next.toFixed(2)]);
    return { method: "brightness-cli" };
  }
  const keyCode = direction === "up" ? 144 : 145;
  const script = [
    "tell application \"System Events\"",
    ...Array.from({ length: n }, () => `key code ${keyCode}`),
    "end tell",
  ].join("\n");
  try {
    await osascript(script);
  } catch (err) {
    throw explainBrightnessError(err);
  }
  return { method: "key-simulation" };
}

// ─── Apps & URLs ──────────────────────────────────────────────────────────────

export async function openApp(name: string): Promise<void> {
  // `open -a` resolves app names case-insensitively and errors on unknown apps.
  await run("/usr/bin/open", ["-a", name]);
}

export async function quitApp(name: string): Promise<void> {
  const escaped = name.replace(/"/g, '\\"');
  await osascript(`tell application "${escaped}" to quit`);
}

export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
  // Lazy import keeps this module loadable outside Electron (vitest runs in Node).
  const { shell } = await import("electron");
  await shell.openExternal(url);
}

// ─── Permissions ─────────────────────────────────────────────────────────────

/** True when Nova holds macOS Accessibility trust (required for any System
 *  Events UI scripting: clicking buttons, typing into other apps, driving the
 *  Clock app). `prompt: true` surfaces the system dialog + Settings deep-link
 *  the first time. Lazy electron import so vitest can load this module. */
export async function hasAccessibility(prompt = false): Promise<boolean> {
  try {
    const { systemPreferences } = await import("electron");
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  } catch {
    return false;
  }
}

/** Opens System Settings straight to a Privacy pane. */
export async function openPrivacySettings(
  pane: "Accessibility" | "Automation" = "Accessibility",
): Promise<void> {
  const { shell } = await import("electron");
  await shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`,
  );
}

const ACCESSIBILITY_FIX =
  "Nova needs macOS Accessibility permission to control apps this way. Grant it " +
  "in System Settings → Privacy & Security → Accessibility (toggle Nova on — or " +
  "'Electron' while running in dev), then ask me again. I've opened that pane for you.";

/** Preflight for any UI-scripting automation: if Accessibility isn't granted,
 *  prompt for it, open the pane, and throw an actionable error instead of
 *  letting osascript fail with an opaque -1719. */
async function requireAccessibility(): Promise<void> {
  if (await hasAccessibility(true)) return;
  await openPrivacySettings("Accessibility").catch(() => {});
  throw new Error(ACCESSIBILITY_FIX);
}

/** Heuristic: does this AppleScript drive another app's UI (needs
 *  Accessibility) rather than just talk to a scriptable app (needs Automation,
 *  which prompts on its own)? */
function usesUiScripting(script: string): boolean {
  return /\bSystem Events\b/i.test(script) && /\b(keystroke|key code|click|perform action|set value|UI element)\b/i.test(script);
}

// ─── General automation (AppleScript / Shortcuts) ────────────────────────────

/** Rewrites common macOS automation permission errors into actionable text so
 *  the model reports what the user must grant instead of a raw error code. */
function explainAutomationError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not allowed to send keystrokes|not allowed assistive access|1002|-25211/.test(msg)) {
    return new Error(
      "AppleScript FAILED: macOS blocked UI scripting. Fix: grant Nova the " +
        "Accessibility permission in System Settings → Privacy & Security → " +
        "Accessibility, then retry.",
    );
  }
  if (/Not authorized to send Apple events|-1743/.test(msg)) {
    return new Error(
      "AppleScript FAILED: macOS blocked Automation for the target app. Fix: " +
        "System Settings → Privacy & Security → Automation → allow Nova to " +
        "control that app, then retry.",
    );
  }
  return new Error(`AppleScript FAILED: ${msg}`);
}

/** Runs an arbitrary AppleScript (execFile, no shell — the script is passed as
 *  a single -e argument so there is no quoting/injection surface). */
export async function runAppleScript(
  script: string,
  timeoutMs = 20_000,
): Promise<{ output: string }> {
  if (!script.trim()) throw new Error("script is required");
  // Preflight UI-scripting scripts so a missing Accessibility grant returns an
  // actionable message (and opens the pane) instead of osascript's opaque
  // -1719 — the reason "control an app" silently did nothing.
  if (usesUiScripting(script)) await requireAccessibility();
  try {
    const output = await run("/usr/bin/osascript", ["-e", script], timeoutMs);
    return { output };
  } catch (err) {
    throw explainAutomationError(err);
  }
}

/**
 * Sets a countdown timer in the macOS Clock app via System Events UI
 * scripting. Clock has no AppleScript dictionary and no timer URL scheme, so
 * driving its UI is the only way to set a timer *inside Clock* specifically.
 * Requires Accessibility. Returns after starting it.
 */
export async function setClockTimer(
  totalSeconds: number,
  label?: string,
): Promise<{ started: true; hours: number; minutes: number; seconds: number }> {
  await requireAccessibility();
  const secs = Math.max(1, Math.round(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  const labelLine = label ? `\n        set value of text field 1 to ${JSON.stringify(label)}` : "";

  // Clock's Timers tab exposes three text fields (hours, minutes, seconds) and
  // a Start button. Field/button names are stable across recent macOS; the
  // script selects the Timers tab first, fills the fields, and clicks Start.
  const script = `
tell application "Clock" to activate
delay 0.5
tell application "System Events"
  tell process "Clock"
    set frontmost to true
    -- Select the Timers tab (toolbar button labelled "Timers").
    try
      click (first button of toolbar 1 of window 1 whose description is "Timers")
    on error
      try
        click (first radio button of tab group 1 of window 1 whose title is "Timers")
      end try
    end try
    delay 0.3
    set tf to text fields of window 1
    if (count of tf) ≥ 3 then
      set value of item 1 of tf to "${String(hours)}"
      set value of item 2 of tf to "${String(minutes)}"
      set value of item 3 of tf to "${String(seconds)}"${labelLine}
    end if
    delay 0.2
    click (first button of window 1 whose title is "Start")
  end tell
end tell
return "started"
`;
  try {
    await run("/usr/bin/osascript", ["-e", script], 15_000);
  } catch (err) {
    throw explainAutomationError(err);
  }
  return { started: true, hours, minutes, seconds };
}

/** Runs a macOS Shortcut by name via the `shortcuts` CLI, optionally passing
 *  text input. */
export async function runShortcut(
  name: string,
  input?: string,
): Promise<{ output: string }> {
  if (!name.trim()) throw new Error("name is required");
  const args = ["run", name.trim()];
  if (input !== undefined && input !== "") {
    // `shortcuts run` reads provided input from stdin with `-i -`; simpler and
    // just as effective is a temp-free echo via osascript — but the CLI also
    // accepts input on stdin only from a file path, so pass via stdin pipe.
    return new Promise((resolve, reject) => {
      const child = execFile(
        "/usr/bin/shortcuts",
        [...args, "-i", "-"],
        { timeout: 30_000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr.trim() || err.message));
          else resolve({ output: stdout.trim() });
        },
      );
      child.stdin?.write(input);
      child.stdin?.end();
    });
  }
  const output = await run("/usr/bin/shortcuts", args, 30_000);
  return { output };
}

/** Lists the user's installed Shortcuts (names, one per line). */
export async function listShortcuts(): Promise<{ shortcuts: string[] }> {
  const out = await run("/usr/bin/shortcuts", ["list"], 10_000);
  return { shortcuts: out.split("\n").map((s) => s.trim()).filter(Boolean) };
}

// ─── Media playback (system-wide) ────────────────────────────────────────────

// NX media-key codes posted to the "Now Playing" session — controls whatever
// is currently playing (YouTube Music in a browser, Spotify, Apple Music, …).
const MEDIA_KEYS = {
  playpause: 16, // NX_KEYTYPE_PLAY
  next: 17, // NX_KEYTYPE_NEXT
  previous: 18, // NX_KEYTYPE_PREVIOUS
} as const;

export type MediaAction = keyof typeof MEDIA_KEYS;

/**
 * Play/pause/skip whatever media is currently playing, by posting the macOS
 * media keys via a JXA (JavaScript for Automation) osascript. Modern Chrome
 * and Safari register web media (YouTube Music, etc.) with the system Now
 * Playing session, so this controls a browser tab too — no per-browser
 * "Allow JavaScript from Apple Events" toggle needed. Requires Accessibility
 * (CGEventPost is gated on it).
 */
export async function controlMedia(action: MediaAction): Promise<{ action: MediaAction }> {
  await requireAccessibility();
  const keyCode = MEDIA_KEYS[action];
  if (keyCode === undefined) throw new Error(`Unknown media action: ${action}`);
  // JXA posts an NSSystemDefined event down+up for the media key.
  const jxa = `
ObjC.import('Cocoa');
function mediaKey(k){
  function post(down){
    var data1 = (k << 16) | ((down ? 0xA : 0xB) << 8);
    var ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      14, $.NSMakePoint(0,0), (down ? 0xA00 : 0xB00), 0, 0, $(), 8, data1, -1);
    $.CGEventPost(0, ev.CGEvent);
  }
  post(true); post(false);
}
mediaKey(${keyCode});
`;
  try {
    await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa], 8_000);
  } catch (err) {
    throw explainAutomationError(err);
  }
  return { action };
}

/** Scrapes YouTube's public search results page for the first video id — no
 *  API key. Returns null if nothing parseable comes back. */
async function firstYouTubeVideoId(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    const html = await res.text();
    const m = html.match(/"videoId":"([0-9A-Za-z_-]{11})"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Plays a query on YouTube Music. Rather than driving the fragile web UI, it
 * resolves the top matching track's video id from YouTube search and opens the
 * YouTube Music WATCH url for it, which the player autoplays — in the user's
 * default browser, on their signed-in account. Falls back to opening the
 * search page if no id could be resolved. No Accessibility needed (just opens
 * a URL); transport control afterwards is control_media.
 */
export async function playOnYouTubeMusic(query: string): Promise<{ played: boolean; note: string }> {
  const q = query.trim();
  if (!q) throw new Error("query is required");

  const { shell } = await import("electron");
  const videoId = await firstYouTubeVideoId(q);

  if (videoId) {
    await shell.openExternal(`https://music.youtube.com/watch?v=${videoId}`);
    return { played: true, note: `Playing "${q}" on YouTube Music.` };
  }

  await shell.openExternal(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`);
  return {
    played: false,
    note: `Couldn't resolve a track for "${q}", so I opened the YouTube Music search — pick one, then say "pause"/"skip" to control it.`,
  };
}
