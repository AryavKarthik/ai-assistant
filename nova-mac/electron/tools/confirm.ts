// Native "are you sure?" gate for tools that execute arbitrary code (shell,
// AppleScript, JavaScript in the user's browser). Claude also reads untrusted
// text — emails, web pages, browser tabs — and agent loops run with nobody
// watching, so a prompt-injected instruction could otherwise run commands on
// this machine silently. The user must click "Run" for every such call.
//
// No top-level electron import: handlers.ts (which uses this) is loaded by
// vitest in plain Node.

/** How long the dialog waits before treating silence as "no" (e.g. an agent
 *  loop firing while the user is away). */
const CONFIRM_TIMEOUT_MS = 60_000;
const MAX_DETAIL_CHARS = 1500;

export const CONFIRMATION_DECLINED = "The user did not approve running this (declined or no answer within 60s). Do not retry it without asking them first.";

export async function confirmCodeExecution(kind: string, code: string, purpose?: string): Promise<boolean> {
  const { app, dialog } = await import("electron");
  const shown = code.length > MAX_DETAIL_CHARS ? code.slice(0, MAX_DETAIL_CHARS) + "\n…(truncated)" : code;
  const detail = (purpose ? `Purpose: ${purpose}\n\n` : "") + shown;

  // Tray-only app (dock hidden): pull focus so the dialog isn't buried.
  try { app.focus({ steal: true }); } catch { /* best effort */ }

  const answer = dialog
    .showMessageBox({
      type: "warning",
      title: "Nova",
      message: `Nova wants to run ${kind}`,
      detail,
      buttons: ["Cancel", "Run"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then((r) => r.response === 1);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CONFIRM_TIMEOUT_MS));
  return Promise.race([answer, timeout]);
}
