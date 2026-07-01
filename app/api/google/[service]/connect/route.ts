import { NextResponse } from "next/server";
import { handleGoogleConnect } from "@/lib/google/connect-handler";
import { parseGoogleService } from "@/lib/google/scopes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service: raw } = await params;
  const service = parseGoogleService(raw);
  if (!service) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return handleGoogleConnect(service);
}
