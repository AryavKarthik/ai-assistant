import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

// The orb window is ALWAYS panel-sized. Collapsed vs expanded is purely a
// renderer state: collapsed shows only the orb (pinned to the window's
// top-right corner) with the rest of the window click-through, expanded fades
// the chat chrome in around it. Never resizing the window is what lets the orb
// stay pixel-stationary and flicker-free across the transition.
export const ORB_PANEL_WIDTH = 380;
export const ORB_PANEL_HEIGHT = 520;
// Tight to the corner, hugging the menu bar the way Siri's own icon does.
const ORB_MARGIN = 8;

/**
 * Position the orb window at the top-right of the display the cursor is on
 * (Siri-style corner popup), just under the menu bar. The orb itself hugs the
 * window's top-right corner, so this puts the orb in the screen corner.
 */
export function positionOrbTopRight(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  win.setBounds(
    {
      x: x + width - ORB_PANEL_WIDTH - ORB_MARGIN,
      y: y + ORB_MARGIN,
      width: ORB_PANEL_WIDTH,
      height: ORB_PANEL_HEIGHT,
    },
    false,
  );
}

/**
 * Notify the caller when the display setup changes — an external monitor
 * gets connected/disconnected, resolution or arrangement changes, etc.
 * (Moving between virtual desktops/Spaces on the same display needs no
 * handling: `setVisibleOnAllWorkspaces` already keeps the window present
 * there without repositioning.) The caller decides what to do: reposition to
 * the default corner, or leave a user-dragged position alone if it's still
 * on-screen (see `isPointOnAnyDisplay`).
 */
export function watchDisplayChanges(onChange: () => void): () => void {
  screen.on("display-added", onChange);
  screen.on("display-removed", onChange);
  screen.on("display-metrics-changed", onChange);
  return () => {
    screen.removeListener("display-added", onChange);
    screen.removeListener("display-removed", onChange);
    screen.removeListener("display-metrics-changed", onChange);
  };
}

/** True if the point falls within any connected display's bounds. */
export function isPointOnAnyDisplay(point: { x: number; y: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.bounds;
    return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
  });
}

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: ORB_PANEL_WIDTH,
    height: ORB_PANEL_HEIGHT,
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
    // No vibrancy: the mini state must be a fully transparent window with only
    // the orb visible (panel styling comes from CSS).
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

  // Stays hidden until a wake word, timer, or hotkey activates it — never
  // shown just because the window finished loading (same in dev and prod).
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
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
