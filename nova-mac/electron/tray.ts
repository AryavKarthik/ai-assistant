import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";

export function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(
    join(import.meta.dirname, "../../build/trayTemplate.png"),
  );
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip("Nova");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Nova", click: () => win.show() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => (win.isVisible() ? win.hide() : win.show()));
  return tray;
}
