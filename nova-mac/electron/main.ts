import { config as loadEnv } from "dotenv";
// Load env into the main process BEFORE anything reads process.env (e.g. Supabase,
// Anthropic, OpenAI). electron-vite does not populate process.env for the main
// process the way Next.js auto-loads .env.local — we must do it explicitly.
// .env.local takes precedence; .env is a fallback (dotenv never overrides set vars).
loadEnv({ path: [".env.local", ".env"] });

import { app, BrowserWindow, globalShortcut, ipcMain, Notification } from "electron";
import { join, resolve } from "node:path";
import {
  createOrbWindow,
  createAppWindow,
  positionOrbTopRight,
  watchDisplayChanges,
  isPointOnAnyDisplay,
} from "./window";
import { loadOrbPosition, saveOrbPosition } from "./orb-position-store";
import { initTimerManager } from "./timers";
import { createTray } from "./tray";
import { registerIpcHandlers, registerChatBridge, registerWakeBridge, registerWindowHandlers } from "./ipc";
import { streamChat, cancelChat } from "./chat";
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";
import { WakeWordController, wakeThresholdFromSensitivity } from "./wakeword/index";
import { IpcChannel, type OrbDragMoveRequest } from "@shared/types";

let orbWin: BrowserWindow | null = null;
let appWin: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let _trayRef: ReturnType<typeof createTray> | null = null;

// Siri-style orb lifecycle: the orb window is hidden by default and only
// appears when something *activates* it — a wake word, a timer, or the user
// explicitly opening it (click / hotkey). System-triggered appearances
// (wake word, timer) auto-hide again once the interaction settles; the user
// opening it manually keeps it around (shrinks to the mini orb, doesn't
// vanish) until they explicitly close it.
let orbExpanded = false;
/** True while the orb is visible ONLY because a wake word/timer showed it —
 *  cleared the moment the user manually interacts with it. */
let orbArmedForAutoHide = false;
let orbHideTimer: ReturnType<typeof setTimeout> | null = null;

// The user can drag the orb anywhere; once they do, we stop forcing it back
// to the top-right corner and remember where they left it (persisted to
// disk). `moved` fires for *every* position change though, including our own
// programmatic ones (positionOrbTopRight/setPosition) — `orbMoveIsProgrammatic`
// suppresses those so only real user drags get treated as "the user chose a
// spot" and saved.
let orbUserPositioned = false;
let orbMoveIsProgrammatic = false;

/** Wrap any programmatic setBounds/setPosition call so the resulting `moved`
 *  event isn't mistaken for a user drag. */
function moveOrbProgrammatically(fn: () => void): void {
  orbMoveIsProgrammatic = true;
  fn();
  // Electron delivers `moved` asynchronously; give it a beat to land before
  // resuming user-drag tracking.
  setTimeout(() => {
    orbMoveIsProgrammatic = false;
  }, 150);
}

function clearOrbHideTimer(): void {
  if (orbHideTimer) {
    clearTimeout(orbHideTimer);
    orbHideTimer = null;
  }
}

function scheduleOrbAutoHide(delayMs: number): void {
  clearOrbHideTimer();
  orbHideTimer = setTimeout(() => {
    orbHideTimer = null;
    if (orbArmedForAutoHide && orbWin && !orbWin.isDestroyed()) {
      orbWin.hide();
      orbArmedForAutoHide = false;
    }
  }, delayMs);
}

function setOrbExpanded(on: boolean): void {
  if (!orbWin || orbWin.isDestroyed()) return;
  orbExpanded = on;
  // The window never resizes — expanding is a pure renderer animation around
  // the stationary orb. Just make sure the panel is immediately clickable;
  // on collapse the renderer re-engages hover-gated click-through itself.
  if (on) orbWin.setIgnoreMouseEvents(false);
  orbWin.webContents.send(IpcChannel.OrbExpandedChanged, on);
}

/** Positions the orb at the default corner, unless the user has dragged it
 *  somewhere else and that spot is still on-screen. */
function positionOrb(): void {
  if (!orbWin || orbWin.isDestroyed()) return;
  if (orbUserPositioned && isPointOnAnyDisplay(orbWin.getBounds())) return;
  moveOrbProgrammatically(() => positionOrbTopRight(orbWin!));
}

/** Shows the orb (mini) for a system-triggered activation — wake word or timer. */
function activateOrb(): void {
  if (!orbWin || orbWin.isDestroyed()) return;
  clearOrbHideTimer();
  if (!orbWin.isVisible()) {
    positionOrb();
    // showInactive: don't steal focus from whatever the user is doing.
    orbWin.showInactive();
  }
  orbArmedForAutoHide = true;
}

app.dock?.hide(); // no Dock icon — tray-only

// In dev (unpackaged via `electron .`), setAsDefaultProtocolClient("nova") alone
// registers the scheme against the bare Electron binary with no argument for
// which app to load — macOS then relaunches plain
// ".../Electron.app/Contents/MacOS/Electron" with no path, which falls back to
// Electron's own bundled default app (or its bare CLI usage text) instead of
// Nova, and clicking a magic-link/OAuth deep link looks like it's silently
// broken. process.defaultApp is true only in this unpackaged case; passing
// process.execPath + the resolved app directory is Electron's documented fix
// (https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app).
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("nova", process.execPath, [resolve(process.argv[1]!)]);
  }
} else {
  app.setAsDefaultProtocolClient("nova");
}
// macOS delivers deep links via open-url
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url.startsWith("nova://auth-callback")) {
    void handleAuthCallback(url);
  } else if (url.startsWith("nova://connections-callback")) {
    void import("./google/connections").then((m) => m.handleConnectionsCallback(url, appWin));
  }
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

  registerWindowHandlers(
    () => orbWin,
    () => appWin,
    () => {
      appWin = createAppWindow();
      appWin.on("closed", () => {
        appWin = null;
      });
      return appWin;
    },
    () => {
      clearOrbHideTimer();
      orbArmedForAutoHide = false;
    },
    () => {
      clearOrbHideTimer();
      orbArmedForAutoHide = false;
    },
  );

  // Prefs
  ipcMain.handle(IpcChannel.PrefsGet, () =>
    import("./voice/save-preferences").then((m) => m.getAllPreferences()),
  );
  ipcMain.handle(IpcChannel.PrefsSet, async (_e, patch: { voice?: unknown; proactive?: unknown }) => {
    const mod = await import("./voice/save-preferences");
    if (patch.voice) await mod.saveVoicePreferences(patch.voice as never);
    if (patch.proactive) await mod.saveProactivePreferences(patch.proactive as Record<string, unknown>);
    const updated = await mod.getAllPreferences();
    wake.setThreshold(wakeThresholdFromSensitivity(updated.voice.wakeWordSensitivity));
    // Broadcast to all windows so orb voice prefs stay in sync
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannel.PrefsChanged, updated.voice);
    }
    return updated;
  });

  // Reminders
  ipcMain.handle(IpcChannel.RemindersGet, () =>
    import("./memory/reminders").then((m) => m.listRemindersIpc()),
  );
  ipcMain.handle(IpcChannel.RemindersDone, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.completeReminderIpc(id)),
  );
  ipcMain.handle(IpcChannel.RemindersDelete, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.deleteReminderIpc(id)),
  );

  // Connections
  ipcMain.handle(IpcChannel.ConnectionsStatus, () =>
    import("./google/connections").then((m) => m.getConnectionsStatus()),
  );
  ipcMain.handle(IpcChannel.ConnectionsConnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.startOAuthFlow(req.service as import("./google/scopes").GoogleService),
    ),
  );
  ipcMain.handle(IpcChannel.ConnectionsDisconnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.disconnectService(req.service as import("./google/scopes").GoogleService),
    ),
  );

  // Memory
  ipcMain.handle(IpcChannel.MemorySearch, (_e, req: { query: string }) =>
    import("./memory/manage").then((m) => m.searchMemoriesIpc(req.query)),
  );
  ipcMain.handle(IpcChannel.MemoryPin, (_e, req: { id: string; pinned: boolean }) =>
    import("./memory/manage").then((m) => m.pinMemoryIpc(req.id, req.pinned)),
  );
  ipcMain.handle(IpcChannel.MemoryArchive, (_e, req: { id: string; archived: boolean }) =>
    import("./memory/manage").then((m) => m.archiveMemoryIpc(req.id, req.archived)),
  );
  ipcMain.handle(IpcChannel.MemoryDelete, (_e, id: string) =>
    import("./memory/manage").then((m) => m.deleteMemoryIpc(id)),
  );

  // Wake-word controller: resolve models dir for dev vs packaged builds
  const modelsDir = app.isPackaged
    ? join(process.resourcesPath, "wakeword-models")
    : join(app.getAppPath(), "electron", "wakeword", "models");
  const wake = new WakeWordController(modelsDir);
  wake.start(() => {
    wake.pauseForTurn(); // stop ingesting frames during the voice turn
    activateOrb(); // pop the mini orb in; auto-hides once the turn settles
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IpcChannel.WakeDetected);
  });
  registerWakeBridge({
    pushFrame: (buf) => wake.pushFrame(buf),
    setEnabled: (on) => wake.setEnabled(on),
  });
  // Apply the user's saved wakeWordSensitivity on startup — previously this
  // preference was persisted but never actually read, so the fire threshold
  // was always the fixed default regardless of what Settings showed.
  import("./voice/preferences")
    .then((m) => m.getVoicePreferences())
    .then((p) => wake.setThreshold(wakeThresholdFromSensitivity(p.wakeWordSensitivity)))
    .catch(() => {});
  // Resume wake detection once the voice turn completes, and — if this
  // appearance was system-triggered and the user never opened the panel —
  // tuck the orb away again after a moment.
  ipcMain.on(IpcChannel.VoiceTurnEnded, () => {
    wake.resume();
    if (orbArmedForAutoHide && !orbExpanded) {
      scheduleOrbAutoHide(1500);
    }
  });

  // Renderer requests to grow/shrink the orb. `manual` distinguishes a real
  // user action (click, hotkey, sign-in) from a system-driven change (the
  // renderer auto-expanding/collapsing for a timer notice): manual opens
  // disarm auto-hide and force the window visible; system-driven collapses
  // while still armed hide the window outright instead of just shrinking it.
  ipcMain.on(IpcChannel.OrbSetExpanded, (_e, on: boolean, manual?: boolean) => {
    if (manual) {
      clearOrbHideTimer();
      orbArmedForAutoHide = false;
      if (on && orbWin && !orbWin.isDestroyed() && !orbWin.isVisible()) {
        positionOrb();
        orbWin.show();
      }
    }
    setOrbExpanded(on);
    if (!manual && !on && orbArmedForAutoHide) {
      orbWin?.hide();
      orbArmedForAutoHide = false;
    }
  });

  // Kill phrase ("stop", "that's all", ...): the renderer already dismisses
  // the turn/UI on its own (orb-machine "dismiss"); this only prevents the
  // system-triggered-popup auto-hide from kicking in afterward, since saying
  // a kill phrase is the user actively engaging with the orb, not walking
  // away from an unopened wake-word popup.
  ipcMain.on(IpcChannel.OrbDisarmAutoHide, () => {
    clearOrbHideTimer();
    orbArmedForAutoHide = false;
  });

  // Collapsed-mode click-through: the always-panel-sized window must not eat
  // clicks meant for whatever is under its invisible area. The renderer flips
  // this based on hover: ignore (with mousemove forwarding, so hover is still
  // observable) everywhere except over the orb itself.
  ipcMain.on(IpcChannel.OrbSetMouseIgnore, (_e, ignore: boolean) => {
    if (!orbWin || orbWin.isDestroyed()) return;
    orbWin.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  // Manual orb drag: the renderer streams pointer deltas (Orb.tsx) and we
  // move the window. Deliberately NOT wrapped in moveOrbProgrammatically — these
  // are real user drags, so the `move`/`moved` listeners below should fire as
  // usual (jelly-wiggle velocity + position persistence).
  ipcMain.on(IpcChannel.OrbDragMove, (_e, { dx, dy }: OrbDragMoveRequest) => {
    if (!orbWin || orbWin.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [x, y] = orbWin.getPosition();
    orbWin.setPosition(x + Math.round(dx), y + Math.round(dy), false);
  });

  // Session timers (set via the set_timer tool). On fire: notification + orb popup;
  // the orb renderer plays the chime and shows the label (and collapses after).
  initTimerManager((timer) => {
    if (Notification.isSupported()) {
      new Notification({ title: "Timer done", body: timer.label }).show();
    }
    activateOrb();
    // The renderer expands the panel itself when the notice lands (and
    // collapses it again after the notice dismisses, which hides us per above).
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannel.TimerFired, { id: timer.id, label: timer.label });
    }
  });

  try {
    const { probeNative } = await import("./native-probe/index.js");
    console.log("[nova] native probe:", probeNative());
  } catch {
    console.warn("[nova] native probe not built (expected in dev)");
  }
  await restoreSession();
  orbWin = createOrbWindow();

  // Restore a previously-dragged position, if it's still on a connected display.
  const savedPos = loadOrbPosition();
  if (savedPos && isPointOnAnyDisplay(savedPos)) {
    moveOrbProgrammatically(() => orbWin!.setPosition(savedPos.x, savedPos.y, false));
    orbUserPositioned = true;
  }

  // Real user drags (not our own programmatic repositioning) — persist where
  // they left it and stop auto-centering it back to the corner. `moved`
  // (macOS-only) fires once when a drag finishes.
  orbWin.on("moved", () => {
    if (orbMoveIsProgrammatic || !orbWin || orbWin.isDestroyed()) return;
    orbUserPositioned = true;
    const { x, y } = orbWin.getBounds();
    saveOrbPosition({ x, y });
  });

  // `move` (cross-platform) fires continuously *while* dragging — used only
  // to compute live velocity so the renderer can wiggle the orb like jelly
  // as it's dragged. Reset the tracking point whenever the window is hidden
  // or resized/repositioned by us, so a stale gap doesn't get read as motion.
  let lastMove: { x: number; y: number; t: number } | null = null;
  orbWin.on("move", () => {
    if (orbMoveIsProgrammatic || !orbWin || orbWin.isDestroyed()) return;
    const now = Date.now();
    const { x, y } = orbWin.getBounds();
    if (lastMove) {
      const dt = Math.max(1, now - lastMove.t);
      orbWin.webContents.send(IpcChannel.OrbDragVelocity, {
        vx: (x - lastMove.x) / dt,
        vy: (y - lastMove.y) / dt,
      });
    }
    lastMove = { x, y, t: now };
  });
  orbWin.on("hide", () => {
    lastMove = null;
  });

  // If a monitor gets connected/disconnected/reconfigured, only reposition
  // when there's no user-chosen spot, or that spot fell off-screen.
  watchDisplayChanges(() => {
    if (!orbWin || orbWin.isDestroyed() || !orbWin.isVisible()) return;
    if (orbUserPositioned && isPointOnAnyDisplay(orbWin.getBounds())) return;
    orbUserPositioned = false;
    moveOrbProgrammatically(() => positionOrbTopRight(orbWin!));
  });

  _trayRef = createTray(orbWin, () => {
    // "Open Nova" tray item callback — manual action, disarm auto-hide.
    clearOrbHideTimer();
    orbArmedForAutoHide = false;
    let app = appWin;
    if (!app || app.isDestroyed()) {
      app = createAppWindow();
      appWin = app;
      app.on("closed", () => {
        appWin = null;
      });
    }
    orbWin?.hide();
    app.show();
    app.focus();
  });
  void _trayRef; // Keep reference to prevent garbage collection
  // Hotkey toggles the chat panel: mini orb ↔ expanded chat. Manual action —
  // disarm auto-hide so the window doesn't vanish out from under the user.
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!orbWin) return;
    clearOrbHideTimer();
    orbArmedForAutoHide = false;
    if (!orbWin.isVisible()) {
      positionOrb();
      orbWin.show();
      setOrbExpanded(true);
      return;
    }
    setOrbExpanded(!orbExpanded);
    if (orbExpanded) orbWin.focus();
  });
  orbWin.once("ready-to-show", () => console.log("[nova] orb window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// Tray-only app: do not quit when the window closes.
app.on("window-all-closed", () => {});
