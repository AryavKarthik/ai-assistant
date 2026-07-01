import { NextResponse } from "next/server";
import { runProactiveCron } from "@/lib/proactive/run-cron";

async function handleCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runProactiveCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Proactive cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
