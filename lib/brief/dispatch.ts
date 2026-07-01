import { composeBriefContext } from "@/lib/brief/compose-context";
import {
  buildFallbackBrief,
  generateDailyBriefText,
} from "@/lib/brief/generate";
import {
  buildClockFromPrefs,
  shouldSendDailyBrief,
} from "@/lib/brief/should-send";
import { markBriefSentForDate } from "@/lib/db/user-preferences";
import { createProactiveNotification } from "@/lib/db/proactive-notifications";
import { sendProactivePush } from "@/lib/proactive/push";
import type { UserPreferences } from "@/lib/proactive/types";
import { getLocalDateKey } from "@/lib/proactive/schedule";

export interface BriefDispatchResult {
  sent: boolean;
  notificationId?: string;
  reason?: string;
}

export async function dispatchDailyBriefIfDue(
  prefs: UserPreferences,
  now = new Date(),
): Promise<BriefDispatchResult> {
  if (!shouldSendDailyBrief({ prefs, now })) {
    return { sent: false, reason: "not_due" };
  }

  const clock = buildClockFromPrefs(prefs, now);
  const localDate = getLocalDateKey(now, prefs.timezone || "UTC");

  let briefText: string;
  try {
    const context = await composeBriefContext(prefs.user_id, clock);
    briefText = context
      ? await generateDailyBriefText(context, clock)
      : buildFallbackBrief(clock);
  } catch (error) {
    console.error("[brief] generation failed:", error);
    briefText = buildFallbackBrief(clock);
  }

  const preview =
    briefText.length > 180 ? `${briefText.slice(0, 177)}…` : briefText;

  const notification = await createProactiveNotification({
    userId: prefs.user_id,
    type: "daily_brief",
    title: "Daily brief",
    body: preview,
    payload: { brief_text: briefText, local_date: localDate },
  });

  await markBriefSentForDate(prefs.user_id, localDate);

  if (prefs.push_proactive_enabled) {
    await sendProactivePush(prefs.user_id, {
      title: "Daily brief",
      body: preview,
      url: `/notifications?id=${notification.id}`,
      type: "daily_brief",
      notificationId: notification.id,
    });
  }

  console.info("[proactive] brief_sent", {
    userId: prefs.user_id,
    notificationId: notification.id,
  });

  return { sent: true, notificationId: notification.id };
}
