import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";
import { currentPlatform } from "./platform/index";

export function createTray(win: BrowserWindow, onOpenApp?: () => void): Tray {
  const icon = currentPlatform().prepareTrayIcon(
    nativeImage.createFromPath(join(import.meta.dirname, "../../build/trayTemplate.png")),
  );
  const tray = new Tray(icon);
  tray.setToolTip("Nova");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Orb", click: () => { win.isVisible() ? win.hide() : win.show(); } },
      { label: "Open Nova", click: () => onOpenApp?.() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => (win.isVisible() ? win.hide() : win.show()));
  return tray;
}
