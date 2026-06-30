import { describe, it, expect } from "vitest";
import { resolveRetrievalPlan, applyMacVoiceOverrides } from "./retrieval-plan";

describe("resolveRetrievalPlan", () => {
  it("returns high memory limit for profile_recall", () => {
    const plan = resolveRetrievalPlan("main", "profile_recall");
    expect(plan.memoryLimit).toBeGreaterThanOrEqual(20);
  });

  it("returns reminders for reminders intent", () => {
    const plan = resolveRetrievalPlan("main", "reminders");
    expect(plan.reminderLimit).toBeGreaterThan(0);
  });

  it("returns moderate memory for general intent", () => {
    const plan = resolveRetrievalPlan("main", "general");
    expect(plan.memoryLimit).toBeGreaterThan(0);
    expect(plan.memoryLimit).toBeLessThanOrEqual(15);
  });
});

describe("applyMacVoiceOverrides", () => {
  it("caps memoryLimit at 12", () => {
    const plan = resolveRetrievalPlan("main", "profile_recall"); // returns 32
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.memoryLimit).toBeLessThanOrEqual(12);
  });

  it("caps chatHistoryLimit at 8", () => {
    const plan = resolveRetrievalPlan("main", "general");
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.chatHistoryLimit).toBeLessThanOrEqual(8);
  });

  it("keeps memoryLimit from plan if already below 12", () => {
    const plan = resolveRetrievalPlan("main", "temporal"); // returns 4
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.memoryLimit).toBeLessThanOrEqual(4);
  });
});
