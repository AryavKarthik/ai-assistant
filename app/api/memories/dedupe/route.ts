import { authJson } from "@/lib/auth/api";
import { dedupeUserMemories } from "@/lib/memory/save";

export async function POST() {
  return authJson(async ({ user }) => {
    const removed = await dedupeUserMemories(user.id);
    return { removed };
  });
}
