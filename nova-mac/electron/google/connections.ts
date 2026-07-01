import { type BrowserWindow } from "electron";

/**
 * Stub — full implementation added in Task 10.
 * Called when macOS delivers a nova://connections-callback deep link after
 * a Google OAuth flow completes in the browser.
 */
export function handleConnectionsCallback(
  _url: string,
  _win: BrowserWindow | null,
): void {
  console.warn("[nova] handleConnectionsCallback: not yet implemented (Task 10)");
}
