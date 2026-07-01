import { NextResponse } from "next/server";
import { authJson } from "@/lib/auth/api";
import { getVapidPublicKey, isPushConfigured } from "@/lib/push/vapid";

export async function GET() {
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push notifications are not configured" },
      { status: 503 },
    );
  }

  return authJson(async () => ({
    publicKey: getVapidPublicKey(),
  }));
}
