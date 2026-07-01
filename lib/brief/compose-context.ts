import { resolveRetrievalPlan } from "@/lib/chat/thread-context";
import type { ContextRetrievalPlan } from "@/lib/chat/thread-context";
import type { RuntimeClockContext } from "@/lib/chat/runtime-context";
import { preRetrieveContext } from "@/lib/memory/search";

const BRIEF_QUERY =
  "What do I have today and this week? Show my agenda, calendar, reminders, and unread emails.";

export function resolveBriefRetrievalPlan(): ContextRetrievalPlan {
  const plan = resolveRetrievalPlan("main", "planning");
  return {
    ...plan,
    gmailHighlightLimit: 3,
    contextNote: "daily brief — calendar, reminders, gmail highlights",
  };
}

export async function composeBriefContext(
  userId: string,
  clock: RuntimeClockContext,
): Promise<string> {
  const plan = resolveBriefRetrievalPlan();
  return preRetrieveContext(userId, BRIEF_QUERY, plan, clock, {
    forceGmail: true,
  });
}
