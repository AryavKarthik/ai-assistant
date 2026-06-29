import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { UnauthorizedError } from "@/lib/auth/session";
import { getWorkflowWithSteps, updateWorkflowStatus } from "@/lib/db/workflows";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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
      if (!["pending", "approved"].includes(workflow.status)) {
        return NextResponse.json(
          { error: "Cannot cancel a workflow that is already running or completed" },
          { status: 400 },
        );
      }
      await updateWorkflowStatus(id, "cancelled");
      return NextResponse.json({ cancelled: true });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/workflow/[id]/cancel error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
