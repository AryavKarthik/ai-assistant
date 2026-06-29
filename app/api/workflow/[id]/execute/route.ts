import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { UnauthorizedError } from "@/lib/auth/session";
import {
  getWorkflowWithSteps,
  updateWorkflowStatus,
  updateStepStatus,
  type WorkflowStepRow,
} from "@/lib/db/workflows";
import { executeTool } from "@/lib/tools/handlers";
import { buildReceipt } from "@/lib/chat/receipts";
import type { ChatActionReceipt } from "@/lib/chat/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  // Verify auth before starting the stream
  let userId: string;
  try {
    const result = await withAuth(async ({ user }) => ({ userId: user.id }));
    userId = result.userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  // Verify workflow ownership and state before starting the stream
  let conversationId: string;
  let steps: WorkflowStepRow[];

  try {
    const workflow = await getWorkflowWithSteps(id);
    if (!workflow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (workflow.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["pending", "approved"].includes(workflow.status)) {
      return NextResponse.json(
        { error: "Workflow is not in an executable state" },
        { status: 400 },
      );
    }
    conversationId = workflow.conversation_id;
    steps = (workflow.steps ?? []).sort((a, b) => a.step_index - b.step_index);
  } catch (error) {
    console.error("POST /api/workflow/[id]/execute pre-check error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);

      try {
        await updateWorkflowStatus(id, "running");

        const receipts: ChatActionReceipt[] = [];

        for (const step of steps) {
          controller.enqueue(
            encode(
              sseEvent({
                type: "step_start",
                stepIndex: step.step_index,
                description: step.description,
                toolName: step.tool_name,
              }),
            ),
          );

          await updateStepStatus(step.id, "running");

          let result: Record<string, unknown>;
          try {
            result = await executeTool(step.tool_name, step.args, {
              userId,
              conversationId,
              sourceMessageId: "",
              userMessage: "",
            });
          } catch (err) {
            const errorMsg =
              err instanceof Error ? err.message : "Unexpected error";
            await updateStepStatus(step.id, "failed", null, errorMsg);
            controller.enqueue(
              encode(
                sseEvent({
                  type: "step_failed",
                  stepIndex: step.step_index,
                  error: errorMsg,
                }),
              ),
            );
            continue;
          }

          const hasError = typeof result.error === "string";
          await updateStepStatus(
            step.id,
            hasError ? "failed" : "completed",
            hasError ? null : result,
            hasError ? String(result.error) : null,
          );

          if (hasError) {
            controller.enqueue(
              encode(
                sseEvent({
                  type: "step_failed",
                  stepIndex: step.step_index,
                  error: String(result.error),
                }),
              ),
            );
          } else {
            const receipt = buildReceipt(step.tool_name, result);
            receipts.push(receipt);
            controller.enqueue(
              encode(
                sseEvent({
                  type: "step_complete",
                  stepIndex: step.step_index,
                  receipt,
                }),
              ),
            );
          }
        }

        await updateWorkflowStatus(id, "completed");
        controller.enqueue(
          encode(
            sseEvent({
              type: "workflow_complete",
              totalSteps: steps.length,
              receipts,
            }),
          ),
        );
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Workflow execution failed";
        await updateWorkflowStatus(id, "failed").catch(() => {});
        controller.enqueue(
          encode(sseEvent({ type: "workflow_error", error: errorMsg })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
