import { app, BrowserWindow, globalShortcut } from "electron";
import { createOrbWindow } from "./window";
import { createTray } from "./tray";

let win: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let trayRef: ReturnType<typeof createTray> | null = null;

app.dock?.hide(); // no Dock icon — tray-only

app.whenReady().then(() => {
  win = createOrbWindow();
  trayRef = createTray(win);
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
  win.once("ready-to-show", () => console.log("[nova] window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// Tray-only app: do not quit when the window closes.
app.on("window-all-closed", () => {});
