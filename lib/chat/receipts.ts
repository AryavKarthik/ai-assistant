import type { ChatActionReceipt, WorkflowStepPreview } from "@/lib/chat/types";

export function deriveTrustTags(receipts: ChatActionReceipt[]): string[] {
  if (receipts.length === 0) return ["Temporary"];
  const tags = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.source === "gmail") {
      tags.add("Used Gmail");
    } else if (receipt.source === "calendar") {
      tags.add("Used Calendar");
    } else if (receipt.source === "youtube") {
      tags.add("Used YouTube");
    } else if (receipt.source === "reminders") {
      tags.add("Used Reminders");
    }
  }
  return [...tags];
}

function receiptSource(toolName: string): ChatActionReceipt["source"] {
  if (toolName.includes("gmail")) return "gmail";
  if (toolName.includes("calendar")) return "calendar";
  if (toolName.includes("youtube")) return "youtube";
  return "temporary";
}

function calendarEventSummary(result: Record<string, unknown>): string {
  const event = result.event;
  if (!event || typeof event !== "object") return "";
  const summary = (event as { summary?: string }).summary;
  return typeof summary === "string" ? summary.trim() : "";
}

export function buildReceipt(
  toolName: string,
  result: Record<string, unknown>,
): ChatActionReceipt {
  const hasError = typeof result.error === "string";
  const id = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (toolName === "save_memory") {
    const action = typeof result.action === "string" ? result.action : "created";
    const outcome =
      action === "created"
        ? "Saved to memory"
        : action === "merged"
          ? "Updated existing memory"
          : action === "replaced"
            ? "Replaced existing memory"
            : "Memory already up to date";
    return {
      id,
      action: "Memory",
      outcome: hasError ? String(result.error) : outcome,
      source: "memory",
      status: hasError ? "error" : "success",
      undo:
        !hasError && action === "created" && typeof result.id === "string"
          ? { type: "delete_memory", targetId: result.id }
          : undefined,
    };
  }

  if (toolName === "create_reminder") {
    return {
      id,
      action: "Reminder",
      outcome: hasError ? String(result.error) : "Created reminder",
      source: "reminders",
      status: hasError ? "error" : "success",
    };
  }

  if (toolName === "complete_reminder") {
    return {
      id,
      action: "Reminder",
      outcome: hasError ? String(result.error) : "Completed reminder",
      source: "reminders",
      status: hasError ? "error" : "success",
      undo:
        !hasError && typeof result.id === "string"
          ? { type: "restore_reminder_pending", targetId: result.id }
          : undefined,
    };
  }

  if (toolName === "create_gmail_draft") {
    const draftId = typeof result.draft_id === "string" ? result.draft_id : "";
    const to = typeof result.to === "string" ? result.to : "";
    const subject = typeof result.subject === "string" ? result.subject : "";
    const preview = typeof result.preview === "string" ? result.preview : "";
    return {
      id,
      action: "Gmail draft",
      outcome: hasError
        ? String(result.error)
        : "Draft ready — review and tap Send",
      source: "gmail",
      status: hasError ? "error" : "info",
      confirm:
        !hasError && draftId
          ? {
              type: "send_gmail_draft",
              draftId,
              to,
              subject,
              preview: preview || undefined,
            }
          : undefined,
    };
  }

  if (toolName === "search_gmail") {
    const count = Array.isArray(result.messages) ? result.messages.length : 0;
    return {
      id,
      action: "Gmail",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Found ${count} message${count === 1 ? "" : "s"}`
          : "No matching messages",
      source: "gmail",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "get_gmail_message") {
    return {
      id,
      action: "Gmail",
      outcome: hasError ? String(result.error) : "Read message",
      source: "gmail",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "list_calendar_events") {
    const count = Array.isArray(result.events) ? result.events.length : 0;
    return {
      id,
      action: "Calendar",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Found ${count} event${count === 1 ? "" : "s"}`
          : "No matching events",
      source: "calendar",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "create_calendar_event") {
    const summary = calendarEventSummary(result);
    return {
      id,
      action: "Calendar",
      outcome: hasError
        ? String(result.error)
        : summary
          ? `Created "${summary}"`
          : "Created event",
      source: "calendar",
      status: hasError ? "error" : "success",
    };
  }

  if (toolName === "update_calendar_event") {
    const summary = calendarEventSummary(result);
    return {
      id,
      action: "Calendar",
      outcome: hasError
        ? String(result.error)
        : summary
          ? `Updated "${summary}"`
          : "Updated event",
      source: "calendar",
      status: hasError ? "error" : "success",
    };
  }

  if (toolName === "delete_calendar_event") {
    return {
      id,
      action: "Calendar",
      outcome: hasError ? String(result.error) : "Deleted event",
      source: "calendar",
      status: hasError ? "error" : "success",
    };
  }

  if (toolName === "search_youtube") {
    const count = Array.isArray(result.videos) ? result.videos.length : 0;
    return {
      id,
      action: "YouTube",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Found ${count} video${count === 1 ? "" : "s"}`
          : "No matching videos",
      source: "youtube",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "recommend_youtube") {
    const count = Array.isArray(result.videos) ? result.videos.length : 0;
    return {
      id,
      action: "YouTube",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Recommended ${count} video${count === 1 ? "" : "s"}`
          : "No recommendations",
      source: "youtube",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "get_youtube_taste_profile") {
    return {
      id,
      action: "YouTube",
      outcome: hasError ? String(result.error) : "Loaded taste profile",
      source: "youtube",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "log_workout") {
    const exercise =
      typeof result.exercise === "string" ? result.exercise.trim() : "";
    return {
      id,
      action: "Workout",
      outcome: hasError
        ? String(result.error)
        : exercise
          ? `Logged ${exercise}`
          : "Logged workout",
      source: "temporary",
      status: hasError ? "error" : "success",
    };
  }

  if (toolName === "web_search") {
    const count = typeof result.count === "number" ? result.count : 0;
    return {
      id,
      action: "Web search",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Found ${count} result${count === 1 ? "" : "s"}`
          : "No results found",
      source: "temporary",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "fetch_webpage") {
    const url = typeof result.url === "string" ? result.url : "";
    const title = typeof result.title === "string" ? result.title : url;
    return {
      id,
      action: "Webpage",
      outcome: hasError ? String(result.error) : `Read: ${title || url}`,
      source: "temporary",
      status: hasError ? "error" : "info",
      confirm: !hasError && url
        ? { type: "open_browser_tab" as const, url, title: title || undefined }
        : undefined,
    };
  }

  if (toolName === "plan_workflow") {
    const workflowId = typeof result.workflow_id === "string" ? result.workflow_id : "";
    const title = typeof result.title === "string" ? result.title : "Workflow";
    const stepCount = typeof result.step_count === "number" ? result.step_count : 0;
    const rawSteps = Array.isArray(result.steps) ? result.steps : [];
    const steps: WorkflowStepPreview[] = rawSteps.map((s: Record<string, unknown>, i: number) => ({
      index: typeof s.index === "number" ? s.index : i,
      description: typeof s.description === "string" ? s.description : "",
      toolName: typeof s.tool_name === "string" ? s.tool_name : "",
      riskLevel: (s.risk_level === "read" || s.risk_level === "write" || s.risk_level === "irreversible")
        ? s.risk_level
        : "write",
    }));
    return {
      id,
      action: "Workflow plan",
      outcome: hasError
        ? String(result.error)
        : `${stepCount} step${stepCount === 1 ? "" : "s"} — tap to review`,
      source: "temporary",
      status: hasError ? "error" : "info",
      confirm: !hasError && workflowId
        ? { type: "approve_workflow" as const, workflowId, title, steps }
        : undefined,
    };
  }

  return {
    id,
    action: toolName.replace(/_/g, " "),
    outcome: hasError ? String(result.error) : "Completed",
    source: receiptSource(toolName),
    status: hasError ? "error" : "info",
  };
}
