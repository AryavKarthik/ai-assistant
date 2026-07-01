import { NextResponse } from "next/server";
import { runDecayCycleForAllUsers } from "@/lib/memory/decay";

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
    const result = await runDecayCycleForAllUsers();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/memory-decay] error:", error);
    return NextResponse.json(
      { error: "Memory decay cycle failed" },
      { status: 500 },
    );
  }
}

export const GET = handleCron;
export const POST = handleCron;
