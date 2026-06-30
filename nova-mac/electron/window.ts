import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    vibrancy: "under-window",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    // Dev only: surface the window + console so renderer errors are visible.
    win.webContents.openDevTools({ mode: "detach" });
    win.once("ready-to-show", () => win.show());
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}
