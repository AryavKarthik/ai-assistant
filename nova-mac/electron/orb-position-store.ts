import { app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface OrbPosition {
  x: number;
  y: number;
}

// v2: the window origin now refers to the always-panel-sized (380×520) window
// with the orb pinned to its top-right — a v1 origin was for a 96×96 window,
// so reusing it would strand the orb ~284px to the right of where the user
// left it. Unversioned (v1) files are ignored: one-time fallback to the corner.
const STORE_VERSION = 2;

function file(): string {
  return join(app.getPath("userData"), "orb-position.json");
}

/** Best-effort — losing a saved drag position isn't worth crashing over. */
export function saveOrbPosition(pos: OrbPosition): void {
  try {
    writeFileSync(file(), JSON.stringify({ v: STORE_VERSION, ...pos }), "utf8");
  } catch {
    // ignore
  }
}

export function loadOrbPosition(): OrbPosition | null {
  const p = file();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as Partial<OrbPosition & { v: number }>;
    if (data.v === STORE_VERSION && typeof data.x === "number" && typeof data.y === "number") {
      return { x: data.x, y: data.y };
    }
    return null;
  } catch {
    return null;
  }
}
