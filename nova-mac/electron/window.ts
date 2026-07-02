import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

export const ORB_WIDTH = 380;
export const ORB_HEIGHT = 520;
const ORB_MARGIN = 16;

/**
 * Position the orb at the top-right of the display the cursor is on
 * (Siri-style corner popup), just under the menu bar.
 */
export function positionOrbTopRight(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  win.setPosition(x + width - ORB_WIDTH - ORB_MARGIN, y + ORB_MARGIN, false);
}

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: ORB_WIDTH,
    height: ORB_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    focusable: true,
    skipTaskbar: true,
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
  // Float above full-screen apps like Siri does.
  win.setAlwaysOnTop(true, "screen-saver");
  positionOrbTopRight(win);

  // Allow mic + camera access — without this Electron silently denies getUserMedia.
  // macOS will still show its own permission dialog on first use.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "mediaKeySystem");
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.once("ready-to-show", () => win.showInactive());
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: true,
    transparent: false,
    vibrancy: "under-window",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#080808",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
}
