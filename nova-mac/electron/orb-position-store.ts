import { app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface OrbPosition {
  x: number;
  y: number;
}

function file(): string {
  return join(app.getPath("userData"), "orb-position.json");
}

/** Best-effort — losing a saved drag position isn't worth crashing over. */
export function saveOrbPosition(pos: OrbPosition): void {
  try {
    writeFileSync(file(), JSON.stringify(pos), "utf8");
  } catch {
    // ignore
  }
}

export function loadOrbPosition(): OrbPosition | null {
  const p = file();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as Partial<OrbPosition>;
    if (typeof data.x === "number" && typeof data.y === "number") {
      return { x: data.x, y: data.y };
    }
    return null;
  } catch {
    return null;
  }
}
