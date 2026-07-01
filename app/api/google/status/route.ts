import { authJson } from "@/lib/auth/api";
import { getGoogleConnectionStatus } from "@/lib/db/google-tokens";

export async function GET() {
  return authJson(async ({ user }) => getGoogleConnectionStatus(user.id));
}
