import { app, BrowserWindow, globalShortcut } from "electron";
import { createOrbWindow } from "./window";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";

let win: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let _trayRef: ReturnType<typeof createTray> | null = null;

app.dock?.hide(); // no Dock icon — tray-only

app.setAsDefaultProtocolClient("nova");
// macOS delivers deep links via open-url
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url.startsWith("nova://auth-callback")) void handleAuthCallback(url);
});

app.whenReady().then(async () => {
  registerIpcHandlers({
    ping: async () => "pong",
    authStatus: getAuthState,
    authSignIn: startSignIn,
    authSignOut: signOut,
    syncConversations: () => import("./sync").then((m) => m.listConversations()),
    syncMemories: () => import("./sync").then((m) => m.listMemories()),
  });
  try {
    const { probeNative } = await import("./native-probe/index.js");
    console.log("[nova] native probe:", probeNative());
  } catch (e) {
    console.warn("[nova] native probe unavailable in dev:", (e as Error).message);
  }
  await restoreSession();
  win = createOrbWindow();
  _trayRef = createTray(win);
  void _trayRef; // Keep reference to prevent garbage collection
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
  win.once("ready-to-show", () => console.log("[nova] window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// Tray-only app: do not quit when the window closes.
app.on("window-all-closed", () => {});
