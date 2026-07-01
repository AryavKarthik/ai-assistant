import { authJson } from "@/lib/auth/api";
import { buildTasteProfile } from "@/lib/google/youtube";

export async function POST() {
  return authJson(async ({ user }) => {
    const profile = await buildTasteProfile(user.id);
    return { profile, refreshedAt: new Date().toISOString() };
  });
}
