import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { UnauthorizedError } from "@/lib/auth/session";
import { getWorkflowWithSteps } from "@/lib/db/workflows";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await withAuth(async ({ user }) => {
      const workflow = await getWorkflowWithSteps(id);
      if (!workflow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (workflow.user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ run: workflow, steps: workflow.steps });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/workflow/[id] error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
