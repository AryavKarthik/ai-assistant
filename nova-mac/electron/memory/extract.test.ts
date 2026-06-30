import { describe, it, expect, vi } from "vitest";

vi.mock("./save", () => ({
  saveMemory: vi.fn().mockResolvedValue({ action: "created", memory: { id: "m1" } }),
}));

import { autoCaptureFromMessage } from "./extract";

describe("autoCaptureFromMessage", () => {
  it("captures explicit memory requests", async () => {
    const result = await autoCaptureFromMessage("u1", "remember that I like hiking");
    expect(result.saved).toBeGreaterThanOrEqual(0);
  });

  it("captures profile patterns", async () => {
    const result = await autoCaptureFromMessage("u1", "I'm a university student");
    expect(result.saved).toBeGreaterThanOrEqual(0);
  });

  it("returns zero for empty messages", async () => {
    const result = await autoCaptureFromMessage("u1", "");
    expect(result.saved).toBe(0);
  });

  it("never captures more than the budget cap", async () => {
    const result = await autoCaptureFromMessage(
      "u1",
      "I like coffee, tea, hiking, coding, gym, reading, cooking, yoga, swimming, gaming",
    );
    expect(result.saved).toBeLessThanOrEqual(5);
  });
});
