import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let userDataDir: string;

vi.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

import { saveOrbPosition, loadOrbPosition } from "./orb-position-store";

describe("orb-position-store", () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "nova-orb-pos-"));
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("returns null when nothing has been saved yet", () => {
    expect(loadOrbPosition()).toBeNull();
  });

  it("round-trips a saved position", () => {
    saveOrbPosition({ x: 120, y: 40 });
    expect(loadOrbPosition()).toEqual({ x: 120, y: 40 });
  });

  it("overwrites a previously saved position", () => {
    saveOrbPosition({ x: 0, y: 0 });
    saveOrbPosition({ x: 999, y: -50 });
    expect(loadOrbPosition()).toEqual({ x: 999, y: -50 });
  });

  it("ignores malformed data on disk", () => {
    saveOrbPosition({ x: 1, y: 1 });
    writeFileSync(join(userDataDir, "orb-position.json"), "{not json", "utf8");
    expect(loadOrbPosition()).toBeNull();
  });

  it("ignores an unversioned (v1, mini-window era) position", () => {
    writeFileSync(join(userDataDir, "orb-position.json"), JSON.stringify({ x: 10, y: 20 }), "utf8");
    expect(loadOrbPosition()).toBeNull();
  });
});
