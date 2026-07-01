import { NextResponse } from "next/server";
import { handleGoogleOAuthCallback } from "@/lib/google/connect-handler";
import { buildTasteProfile } from "@/lib/google/youtube";
import { parseGoogleService } from "@/lib/google/scopes";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service: raw } = await params;
  const service = parseGoogleService(raw);
  if (!service) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const onConnected =
    service === "youtube"
      ? async (userId: string) => {
          try {
            await buildTasteProfile(userId);
          } catch (err) {
            console.error(
              "[youtube] taste profile build on connect failed:",
              err,
            );
          }
        }
      : undefined;

  return handleGoogleOAuthCallback(request, service, onConnected);
}
