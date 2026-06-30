import { describe, it, expect } from "vitest";
import { inferContextIntent } from "./context-intent";

describe("inferContextIntent", () => {
  it("returns reminders for 'remind me'", () => {
    expect(inferContextIntent("remind me to call John", "main")).toBe("reminders");
  });

  it("returns profile_recall for 'what do you know about me'", () => {
    expect(inferContextIntent("what do you know about me", "main")).toBe("profile_recall");
  });

  it("returns planning for schedule queries", () => {
    expect(inferContextIntent("what's my week looking like", "main")).toBe("planning");
  });

  it("returns temporal for date queries", () => {
    expect(inferContextIntent("what day is it today", "main")).toBe("temporal");
  });

  it("returns email for gmail queries", () => {
    expect(inferContextIntent("check my inbox", "main")).toBe("email");
  });

  it("returns general for generic queries", () => {
    expect(inferContextIntent("how are you", "main")).toBe("general");
  });
});
