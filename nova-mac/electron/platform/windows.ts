import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage } from "electron";
import type { PlatformAdapter } from "./index";
import { SHARED_CONTROL_LINES } from "./shared-prompt";

/** ALL Windows-specific behavior lives here (and doubles as the conservative
 *  fallback for Linux) — see PlatformAdapter in index.ts. */

/** Tools whose implementations are macOS-only (AppleScript/osascript, macOS
 *  Shortcuts, Spotlight/mdfind, screencapture, System Settings URLs, macOS
 *  TCC permission checks). Hidden from Claude on Windows so the model never
 *  reaches for automation that can only error — the Phase-2 Windows port
 *  supplies win32 implementations behind these same names and removes the
 *  entries here as they land. */
export const MAC_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "run_applescript",
  "run_shortcut",
  "list_shortcuts",
  "check_mac_permissions",
  "open_app",
  "quit_app",
  "set_system_volume",
  "get_system_volume",
  "set_screen_brightness",
  "control_media",
  "see_screen",
  "take_screenshot",
  "open_settings",
  "search_files",
  "list_browser_tabs",
  "open_browser_tab",
  "activate_browser_tab",
  "close_browser_tab",
  "organize_browser_tabs",
  "read_browser_page",
  "run_browser_js",
]);

const WINDOWS_CONTROL_BLOCK = `Acting on the user's computer (confirmation policy):
- Just do reversible, low-stakes actions (open a page, play music, set a timer). Don't ask permission for these — act, then confirm in one line.
- Confirm FIRST only for actions that are hard to undo or outward-facing: sending a message/email, posting, deleting or overwriting files, purchases, or anything irreversible. State what you're about to do and wait for a yes.

Computer control (you run natively on the user's Windows PC):
${SHARED_CONTROL_LINES}
- MUSIC/VIDEO: default to YouTube. Any "play <song/artist/genre/video>", "put on music", "play something" → call play_youtube with the query; it opens the top result playing in the browser. USE it — never say you can't play music, and never just open a search page and stop.
- run_shell_command: run a Windows shell (cmd) command. Powerful and unsandboxed — prefer a dedicated tool when one exists, and never run something you don't understand.
- System automation beyond these tools (controlling apps, volume/brightness, screenshots, driving the browser, seeing the screen) is NOT available on Windows yet. If asked, say so plainly and offer the closest thing you CAN do — don't attempt it via run_shell_command unless the user explicitly asks for a shell-based workaround.
- After any action, confirm briefly in one sentence what you did (and surface any error clearly).`;

export const windowsPlatform: PlatformAdapter = {
  // Windows has no TCC-style prompt the app can trigger; mic access is a
  // Settings toggle. The renderer's getUserMedia failure path (useVoice)
  // surfaces the "Settings → Privacy & security → Microphone" pointer.
  async ensureMicPermission(): Promise<void> {},

  appWindowOptions(): BrowserWindowConstructorOptions {
    // Win11 acrylic translucency; silently ignored on Win10, which falls
    // back to the window's solid backgroundColor. Standard frame — the
    // AppShell's title-bar inset just reads as padding.
    return { backgroundMaterial: "acrylic" };
  },

  setupOrbWindow(_win: BrowserWindow): void {
    // setVisibleOnAllWorkspaces is a macOS Spaces concept — nothing to do.
  },

  prepareTrayIcon(icon: NativeImage): NativeImage {
    // Windows tray icons render at 16×16; an oversized PNG comes out blurry.
    return icon.resize({ width: 16, height: 16 });
  },

  controlPromptBlock: WINDOWS_CONTROL_BLOCK,
  // undefined = Node's default shell on Windows (cmd.exe).
  shellForCommands: undefined,
  hasNativeMovedEvent: false,
  unavailableTools: MAC_ONLY_TOOLS,
};
