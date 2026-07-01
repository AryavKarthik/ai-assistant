import { dispatchDailyBriefIfDue } from "@/lib/brief/dispatch";
import { dispatchFollowUpsIfDue } from "@/lib/brief/follow-ups";
import { dispatchNudgesIfDue } from "@/lib/brief/nudges";
import {
  listBriefEnabledUsers,
  listProactiveUserPreferences,
} from "@/lib/db/user-preferences";

export interface ProactiveCronResult {
  briefsSent: number;
  nudgesSent: number;
  followUpsSent: number;
  usersProcessed: number;
}

export async function runProactiveCron(
  now = new Date(),
): Promise<ProactiveCronResult> {
  const result: ProactiveCronResult = {
    briefsSent: 0,
    nudgesSent: 0,
    followUpsSent: 0,
    usersProcessed: 0,
  };

  const briefUsers = await listBriefEnabledUsers();
  const processedBrief = new Set<string>();

  for (const prefs of briefUsers) {
    processedBrief.add(prefs.user_id);
    result.usersProcessed++;
    try {
      const brief = await dispatchDailyBriefIfDue(prefs, now);
      if (brief.sent) result.briefsSent++;
    } catch (error) {
      console.error("[proactive cron] brief failed:", prefs.user_id, error);
    }
  }

  const proactiveUsers = await listProactiveUserPreferences();
  const seen = new Set<string>();

  for (const prefs of proactiveUsers) {
    if (seen.has(prefs.user_id)) continue;
    seen.add(prefs.user_id);
    if (!processedBrief.has(prefs.user_id)) {
      result.usersProcessed++;
    }

    try {
      const nudges = await dispatchNudgesIfDue(prefs, now);
      result.nudgesSent += nudges.sent;
    } catch (error) {
      console.error("[proactive cron] nudges failed:", prefs.user_id, error);
    }

    try {
      const followUps = await dispatchFollowUpsIfDue(prefs, now);
      result.followUpsSent += followUps.sent;
    } catch (error) {
      console.error("[proactive cron] follow-ups failed:", prefs.user_id, error);
    }
  }

  return result;
}
