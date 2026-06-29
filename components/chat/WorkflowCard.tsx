"use client";

import { useState, useCallback } from "react";
import type { ChatActionReceipt, WorkflowStepPreview } from "@/lib/chat/types";

type WorkflowState = "pending" | "running" | "done" | "error";

interface StepStatus {
  stepIndex: number;
  state: "pending" | "running" | "completed" | "failed";
  receipt?: ChatActionReceipt;
  error?: string;
}

function riskIcon(riskLevel: WorkflowStepPreview["riskLevel"]): string {
  if (riskLevel === "irreversible") return "⚠";
  if (riskLevel === "write") return "✎";
  return "↗";
}

function riskLabel(riskLevel: WorkflowStepPreview["riskLevel"]): string {
  if (riskLevel === "irreversible") return "Irreversible";
  if (riskLevel === "write") return "Write";
  return "Read";
}

export function WorkflowCard({
  workflowId,
  title,
  steps,
  onComplete,
  onCancel,
}: {
  workflowId: string;
  title: string;
  steps: WorkflowStepPreview[];
  onComplete: (receipts: ChatActionReceipt[]) => void;
  onCancel: () => void;
}) {
  const [workflowState, setWorkflowState] = useState<WorkflowState>("pending");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    steps.map((s) => ({ stepIndex: s.index, state: "pending" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleApprove = useCallback(async () => {
    setBusy(true);
    setWorkflowState("running");

    try {
      const response = await fetch(`/api/workflow/${workflowId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!response.ok || !response.body) {
        throw new Error(`Execute failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const allReceipts: ChatActionReceipt[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          if (!chunk.startsWith("data: ")) continue;
          const json = chunk.slice(6).trim();
          if (!json) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(json) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.type === "step_start") {
            const idx = event.stepIndex as number;
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx ? { ...s, state: "running" } : s,
              ),
            );
          } else if (event.type === "step_complete") {
            const idx = event.stepIndex as number;
            const receipt = event.receipt as ChatActionReceipt | undefined;
            if (receipt) allReceipts.push(receipt);
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx
                  ? {
                      ...s,
                      state: "completed",
                      receipt: receipt ?? undefined,
                    }
                  : s,
              ),
            );
          } else if (event.type === "step_failed") {
            const idx = event.stepIndex as number;
            const errMsg = typeof event.error === "string" ? event.error : "Failed";
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx
                  ? { ...s, state: "failed", error: errMsg }
                  : s,
              ),
            );
          } else if (event.type === "workflow_complete") {
            setWorkflowState("done");
            onComplete(allReceipts);
          } else if (event.type === "workflow_error") {
            const errMsg = typeof event.error === "string" ? event.error : "Workflow failed";
            setError(errMsg);
            setWorkflowState("error");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      setError(msg);
      setWorkflowState("error");
    } finally {
      setBusy(false);
    }
  }, [workflowId, onComplete]);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/workflow/${workflowId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore cancel errors — still dismiss the card
    } finally {
      setBusy(false);
      onCancel();
    }
  }, [workflowId, onCancel]);

  return (
    <div className="my-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {workflowState === "pending"
              ? `${steps.length} step${steps.length === 1 ? "" : "s"} — review before executing`
              : workflowState === "running"
                ? "Running…"
                : workflowState === "done"
                  ? "Complete"
                  : "Error"}
          </p>
        </div>
        {workflowState === "done" && (
          <span className="text-xs text-[#9fdf9f]">✓ Done</span>
        )}
        {workflowState === "error" && (
          <span className="text-xs text-[#e8a0a0]">✗ Failed</span>
        )}
      </div>

      {/* Step list */}
      <ol className="mb-3 space-y-2">
        {steps.map((step) => {
          const status = stepStatuses.find((s) => s.stepIndex === step.index);
          const state = status?.state ?? "pending";
          const stateColor =
            state === "completed"
              ? "text-[#9fdf9f]"
              : state === "failed"
                ? "text-[#e8a0a0]"
                : state === "running"
                  ? "text-[var(--text-primary)] opacity-90"
                  : "text-[var(--text-secondary)]";
          const stateIcon =
            state === "completed"
              ? "✓"
              : state === "failed"
                ? "✗"
                : state === "running"
                  ? "…"
                  : `${step.index + 1}.`;

          return (
            <li key={step.index} className={`flex items-start gap-2 ${stateColor}`}>
              <span className="w-4 shrink-0 text-center font-mono text-xs">
                {stateIcon}
              </span>
              <span className="flex-1 text-xs">
                {step.description}
                {workflowState === "pending" && (
                  <span
                    className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${
                      step.riskLevel === "irreversible"
                        ? "bg-red-900/40 text-red-300"
                        : step.riskLevel === "write"
                          ? "bg-blue-900/30 text-blue-300"
                          : "bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {riskIcon(step.riskLevel)} {riskLabel(step.riskLevel)}
                  </span>
                )}
                {state === "failed" && status?.error && (
                  <span className="ml-1 text-[10px] opacity-70">— {status.error}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Error message */}
      {error && (
        <p className="mb-2 text-xs text-[#e8a0a0]">{error}</p>
      )}

      {/* Action buttons — only shown in pending state */}
      {workflowState === "pending" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Approve all steps"}
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={busy}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
