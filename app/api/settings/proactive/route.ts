import { authJson } from "@/lib/auth/api";
import {
  getUserPreferences,
  upsertUserPreferences,
  type UserPreferencesPatch,
} from "@/lib/db/user-preferences";
import { resolveUserTimezone } from "@/lib/chat/runtime-context";
import type { ProactiveTier } from "@/lib/proactive/types";

const VALID_TIERS = new Set<ProactiveTier>(["off", "reminders_only", "full"]);

export async function GET() {
  return authJson(async ({ user }) => {
    const prefs = await getUserPreferences(user.id);
    return { preferences: prefs };
  });
}

export async function PATCH(request: Request) {
  return authJson(async ({ user }) => {
    const body = (await request.json()) as UserPreferencesPatch & {
      clientTimeZone?: string;
    };

    const patch: UserPreferencesPatch = {};

    if (body.proactive_tier !== undefined) {
      if (!VALID_TIERS.has(body.proactive_tier)) {
        throw new Error("Invalid proactive_tier");
      }
      patch.proactive_tier = body.proactive_tier;
    }
    if (typeof body.brief_enabled === "boolean") {
      patch.brief_enabled = body.brief_enabled;
    }
    if (typeof body.brief_time_local === "string") {
      patch.brief_time_local = body.brief_time_local;
    }
    if (typeof body.timezone === "string" && body.timezone.trim()) {
      patch.timezone = body.timezone.trim();
    } else if (body.clientTimeZone) {
      patch.timezone = body.clientTimeZone;
    }
    if (typeof body.quiet_hours_start === "string") {
      patch.quiet_hours_start = body.quiet_hours_start;
    }
    if (typeof body.quiet_hours_end === "string") {
      patch.quiet_hours_end = body.quiet_hours_end;
    }
    if (typeof body.push_proactive_enabled === "boolean") {
      patch.push_proactive_enabled = body.push_proactive_enabled;
    }

    const existing = await getUserPreferences(user.id);
    if (existing.timezone === "UTC" && !patch.timezone) {
      const resolved = await resolveUserTimezone(user.id);
      if (resolved !== "UTC") {
        patch.timezone = resolved;
      }
    }

    const preferences = await upsertUserPreferences(user.id, patch);
    return { preferences };
  });
}
