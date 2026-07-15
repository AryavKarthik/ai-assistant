import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";

export function createTray(win: BrowserWindow, onOpenApp?: () => void): Tray {
  let icon = nativeImage.createFromPath(
    join(import.meta.dirname, "../../build/trayTemplate.png"),
  );
  if (process.platform === "darwin") {
    // Template rendering (auto light/dark tinting) is a macOS-only concept.
    icon.setTemplateImage(true);
  } else {
    // Windows tray icons render at 16×16; an oversized PNG comes out blurry.
    icon = icon.resize({ width: 16, height: 16 });
  }
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
