import { NextResponse } from "next/server";
import { authJson } from "@/lib/auth/api";
import { disconnectGoogleService } from "@/lib/db/google-tokens";
import { deleteYoutubeTasteCache } from "@/lib/db/youtube-taste";
import { parseGoogleService } from "@/lib/google/scopes";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service: raw } = await params;
  const service = parseGoogleService(raw);
  if (!service) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return authJson(async ({ user }) => {
    await disconnectGoogleService(user.id, service);
    if (service === "youtube") {
      await deleteYoutubeTasteCache(user.id);
    }
    return { success: true };
  });
}
