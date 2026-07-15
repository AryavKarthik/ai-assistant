import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage } from "electron";
import type { PlatformAdapter } from "./index";
import { SHARED_CONTROL_LINES } from "./shared-prompt";

/** ALL macOS-specific behavior lives here — see PlatformAdapter in index.ts. */

const MAC_CONTROL_BLOCK = `Seeing the screen (you have eyes — use them):
- see_screen captures what's on the user's screen and lets you actually look. Call it WHENEVER the question only makes sense visually: "what does this say", "what's this error", "read this", "summarize this", "what app is this", "is this safe to click", or any "this/here/that" pointing at the screen. Don't ask "what are you looking at?" — just look.
- After capturing, answer from what you actually see. Be specific about real on-screen text/elements; if the screenshot is blank or the content isn't visible, say so (it usually means Screen Recording permission is off).

Acting on the Mac (confirmation policy):
- Just do reversible, low-stakes actions (open an app, open/search a page, read the screen, type into a field, play music, adjust volume, navigate). Don't ask permission for these — act, then confirm in one line.
- Confirm FIRST only for actions that are hard to undo or outward-facing: sending a message/email, posting, deleting or overwriting files, purchases, or anything irreversible. State what you're about to do and wait for a yes.

Mac control (you run natively on the user's Mac and CAN do these — never claim you can't):
${SHARED_CONTROL_LINES}
- open_app / quit_app: launch or quit Mac apps ("open Safari", "open Chrome", "quit Spotify").
- set_system_volume / get_system_volume: change or read the Mac's volume, including mute. For "turn it up/down a bit", get the current volume first and adjust ~10–15 points.
- set_screen_brightness: absolute (level 0–1) or relative (direction up/down) display brightness.
- set_timer: countdown timers ("set a timer for 10 minutes") — Nova's own by default; pass in_clock_app: true only when they specifically want the macOS Clock app.
- MUSIC/VIDEO: default to YouTube. Any "play <song/artist/genre/video>", "put on music", "play something", "pull up <video>" → call play_youtube with the query; it opens the top result playing in the browser. Do NOT open Apple Music or the Music app unless the user explicitly says "Apple Music" or "Spotify". For "pause", "resume", "skip", "next", "previous", "go back" → call control_media. These are real capabilities — USE them; never say you can't play or control media, and never just open a search page and stop.
- run_applescript: control and navigate WITHIN apps and browsers — make a note in Notes, drive Safari/Chrome tabs (open URLs, read the current tab, run JS in a tab), message someone, click UI elements. Prefer a dedicated tool when one exists (play_youtube/control_media for media); reach for AppleScript otherwise. Combine with open_app when the app must be running first.
- run_shortcut / list_shortcuts: run the user's macOS Shortcuts by name.
- check_mac_permissions: controlling apps/browsers via UI scripting needs macOS Accessibility permission. If an automation attempt comes back with a permission error (or the user says "you can't control X"), DON'T just accept it — call check_mac_permissions (with open_settings: true) and tell them exactly what to toggle: System Settings → Privacy & Security → Accessibility → turn on Nova (shows as "Electron" in dev). Then they can retry.
- open_settings: jump straight to a System Settings pane (wifi, bluetooth, displays, sound, etc.).
- search_files + open_path: find files/folders anywhere on disk by name or content (Spotlight) and open them. Use these for "find my…", "where is…", "open that file".
- take_screenshot: capture the screen to a PNG (pass interactive for a region/window pick).
- Chrome control: list_browser_tabs (see what's open), open_browser_tab, activate_browser_tab, close_browser_tab. read_browser_page reads the active tab's text ("summarize this tab"). run_browser_js executes JavaScript in the active tab for real agentic tasks — clicking, filling forms, extracting data, scrolling. Read the page first, then act. If Chrome scripting is blocked, tell the user to enable View → Developer → "Allow JavaScript from Apple Events" once.
- run_shell_command: run any zsh command (files, git, CLIs, system info). Powerful and unsandboxed — prefer a dedicated tool when one exists, and never run something you don't understand.
- After any Mac control, browser, or automation action, confirm briefly in one sentence what you did (and surface any error clearly).`;

export const macPlatform: PlatformAdapter = {
  // Microphone TCC, up front and deterministic. Without this, the renderer's
  // first getUserMedia raced the OS prompt, and a previously-denied state made
  // wake capture silently receive nothing. askForMediaAccess resolves false
  // WITHOUT prompting when already denied — hence the notification pointer.
  async ensureMicPermission(): Promise<void> {
    const { systemPreferences, Notification } = await import("electron");
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return;
    const granted = await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    if (!granted && Notification.isSupported()) {
      new Notification({
        title: "Nova can't hear you",
        body: "Enable Nova in System Settings → Privacy & Security → Microphone, then relaunch.",
      }).show();
    }
  },

  appWindowOptions(): BrowserWindowConstructorOptions {
    // Native vibrancy + inset traffic-light title bar — the chrome the
    // AppShell's 28px drag inset is designed around.
    return { vibrancy: "under-window", titleBarStyle: "hiddenInset" };
  },

  setupOrbWindow(win: BrowserWindow): void {
    // Follow the user across Spaces and over full-screen apps, like Siri.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  },

  prepareTrayIcon(icon: NativeImage): NativeImage {
    // Template rendering: macOS tints the icon for light/dark menu bars.
    icon.setTemplateImage(true);
    return icon;
  },

  controlPromptBlock: MAC_CONTROL_BLOCK,
  shellForCommands: "/bin/zsh",
  hasNativeMovedEvent: true,
  unavailableTools: new Set<string>(),
};
