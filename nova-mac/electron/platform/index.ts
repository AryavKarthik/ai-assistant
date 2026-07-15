import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage } from "electron";
import { macPlatform } from "./mac";
import { windowsPlatform } from "./windows";

/**
 * Everything Nova does differently per OS, behind one interface. mac.ts holds
 * ALL macOS-specific behavior; windows.ts holds ALL Windows behavior (and
 * serves as the conservative fallback for Linux). Rules:
 *
 * - These modules must stay importable from plain Node (vitest loads
 *   definitions.ts / system-prompt.ts / mac-control.ts): no top-level
 *   `electron` value imports — type-only imports, instance parameters, or
 *   lazy `await import("electron")` inside functions only.
 * - Consumers resolve the adapter per CALL via currentPlatform(), never at
 *   module load: tests stub process.platform at runtime, and a load-time
 *   snapshot would ignore the stub.
 */
export interface PlatformAdapter {
  /** Ask for microphone access up front; surface a pointer to the OS setting
   *  when it has been denied. No-op where the OS has no such prompt. */
  ensureMicPermission(): Promise<void>;
  /** Window-chrome options merged into createAppWindow's BrowserWindow. */
  appWindowOptions(): BrowserWindowConstructorOptions;
  /** Post-create tweaks for the orb window (Spaces visibility etc.). */
  setupOrbWindow(win: BrowserWindow): void;
  /** Adapt the tray icon (macOS template tinting vs 16px raster). */
  prepareTrayIcon(icon: NativeImage): NativeImage;
  /** Per-OS system-prompt block: what system control Claude can/can't do. */
  controlPromptBlock: string;
  /** Shell for run_shell_command; undefined = Node's platform default. */
  shellForCommands: string | undefined;
  /** Whether Electron fires the native `moved` (drag-finished) event —
   *  macOS-only; elsewhere main.ts synthesizes it from `move` stillness. */
  hasNativeMovedEvent: boolean;
  /** Tool names with no working implementation on this platform — filtered
   *  out of Claude's tool list by getToolDefinitions(). */
  unavailableTools: ReadonlySet<string>;
}

/** Resolved per call, not at module load — see note above. */
export function currentPlatform(): PlatformAdapter {
  return process.platform === "darwin" ? macPlatform : windowsPlatform;
}
