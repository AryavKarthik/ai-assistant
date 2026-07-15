import { afterEach, describe, expect, it } from "vitest";
import { getToolDefinitions, MAC_ONLY_TOOLS, TOOL_DEFINITIONS } from "./definitions";

const realPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", { value: platform });
}

afterEach(() => setPlatform(realPlatform));

describe("getToolDefinitions platform gating", () => {
  it("every MAC_ONLY_TOOLS name exists in TOOL_DEFINITIONS (no stale entries)", () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    for (const name of MAC_ONLY_TOOLS) {
      expect(names.has(name), `${name} missing from TOOL_DEFINITIONS`).toBe(true);
    }
  });

  it("offers macOS automation tools on darwin", () => {
    setPlatform("darwin");
    const names = new Set(getToolDefinitions().map((t) => t.name));
    expect(names.has("run_applescript")).toBe(true);
    expect(names.has("see_screen")).toBe(true);
    expect(names.has("list_browser_tabs")).toBe(true);
  });

  it("hides all macOS-only tools on win32 but keeps cross-platform ones", () => {
    setPlatform("win32");
    const names = new Set(getToolDefinitions().map((t) => t.name));
    for (const name of MAC_ONLY_TOOLS) {
      expect(names.has(name), `${name} should be hidden on win32`).toBe(false);
    }
    for (const kept of [
      "set_timer",
      "play_youtube",
      "open_url",
      "run_shell_command",
      "create_reminder",
      "save_memory",
      "trash_file",
      "get_clipboard",
      "fetch_webpage",
    ]) {
      expect(names.has(kept), `${kept} should remain on win32`).toBe(true);
    }
  });

  it("still strips composio tools regardless of platform when key is absent", () => {
    setPlatform("win32");
    const prev = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    try {
      const names = getToolDefinitions().map((t) => t.name);
      expect(names.some((n) => n.startsWith("composio_"))).toBe(false);
    } finally {
      if (prev !== undefined) process.env.COMPOSIO_API_KEY = prev;
    }
  });
});
