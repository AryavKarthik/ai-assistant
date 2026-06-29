import { app, BrowserWindow, globalShortcut } from "electron";
import { createOrbWindow } from "./window";
import { createTray } from "./tray";

let win: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let _trayRef: ReturnType<typeof createTray> | null = null;

app.dock?.hide(); // no Dock icon — tray-only

app.whenReady().then(() => {
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
