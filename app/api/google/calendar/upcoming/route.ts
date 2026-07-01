import { authJson } from "@/lib/auth/api";
import { listCalendarEvents } from "@/lib/google/calendar";

export async function GET() {
  return authJson(async ({ user }) => {
    const result = await listCalendarEvents(user.id, { maxResults: 5 });
    if ("error" in result) {
      return { events: [], error: result.error };
    }
    return { events: result.events };
  });
}
