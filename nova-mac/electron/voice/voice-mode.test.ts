import { describe, it, expect } from "vitest";
import { getVoiceMode } from "./voice-mode";

describe("VoiceMode registry", () => {
  it("defaults to the pipeline mode", () => {
    expect(getVoiceMode("pipeline").name).toBe("pipeline");
  });
  it("throws for unimplemented live providers", () => {
    expect(() => getVoiceMode("live")).toThrow(/not implemented/i);
  });
});
