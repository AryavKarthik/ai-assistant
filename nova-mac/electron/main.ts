import { config as loadEnv } from "dotenv";
// Load env into the main process BEFORE anything reads process.env (e.g. Supabase,
// Anthropic, OpenAI). electron-vite does not populate process.env for the main
// process the way Next.js auto-loads .env.local — we must do it explicitly.
// .env.local takes precedence; .env is a fallback (dotenv never overrides set vars).
loadEnv({ path: [".env.local", ".env"] });

import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { join } from "node:path";
import { createOrbWindow } from "./window";
import { createTray } from "./tray";
import { registerIpcHandlers, registerChatBridge, registerWakeBridge } from "./ipc";
import { streamChat, cancelChat } from "./chat";
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";
import { WakeWordController } from "./wakeword/index";
import { IpcChannel } from "@shared/types";

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
    transcribe: (req, provider) => import("./voice/stt").then((m) => m.transcribe(req, provider)),
    synthesize: (req) => import("./voice/tts").then((m) => m.synthesize(req)),
    getVoicePreferences: () => import("./voice/preferences").then((m) => m.getVoicePreferences()),
  });
  registerChatBridge({
    start: (req, sender) =>
      void streamChat(req, (channel, payload) => sender.send(channel, payload)),
    cancel: cancelChat,
  });

  // Wake-word controller: resolve models dir for dev vs packaged builds
  const modelsDir = app.isPackaged
    ? join(process.resourcesPath, "wakeword-models")
    : join(app.getAppPath(), "electron", "wakeword", "models");
  const wake = new WakeWordController(modelsDir);
  wake.start(() => {
    wake.pauseForTurn(); // stop ingesting frames during the voice turn
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IpcChannel.WakeDetected);
  });
  registerWakeBridge({
    pushFrame: (buf) => wake.pushFrame(buf),
    setEnabled: (on) => wake.setEnabled(on),
  });
  // Resume wake detection once the voice turn completes (Task 12 sends this)
  ipcMain.on(IpcChannel.VoiceTurnEnded, () => wake.resume());

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
