import { describe, it, expect } from "vitest";
import { orbReducer, INITIAL_ORB_STATE, type OrbState } from "./orb-machine";

const at = (name: OrbState["name"]): OrbState => ({ ...INITIAL_ORB_STATE, name });

describe("orbReducer", () => {
  it("starts dormant", () => {
    expect(INITIAL_ORB_STATE.name).toBe("dormant");
  });

  it("summon: dormant → listening", () => {
    expect(orbReducer(at("dormant"), { type: "summon" }).name).toBe("listening");
  });

  it("submit: listening → processing and stores the transcript", () => {
    const next = orbReducer(at("listening"), { type: "submit", transcript: "what's the weather" });
    expect(next.name).toBe("processing");
    expect(next.transcript).toBe("what's the weather");
  });

  it("responseStart: processing → responding", () => {
    expect(orbReducer(at("processing"), { type: "responseStart" }).name).toBe("responding");
  });

  it("responseDelta accumulates text while responding", () => {
    let s = at("responding");
    s = orbReducer(s, { type: "responseDelta", delta: "Hello" });
    s = orbReducer(s, { type: "responseDelta", delta: " world" });
    expect(s.responseText).toBe("Hello world");
  });

  it("responseEnd: responding → dormant", () => {
    expect(orbReducer(at("responding"), { type: "responseEnd" }).name).toBe("dormant");
  });

  it("bargeIn: responding → bargeIn and clears response text", () => {
    const next = orbReducer({ ...at("responding"), responseText: "abc" }, { type: "bargeIn" });
    expect(next.name).toBe("bargeIn");
    expect(next.responseText).toBe("");
  });

  it("summon: bargeIn → listening (re-arm after barge-in)", () => {
    expect(orbReducer(at("bargeIn"), { type: "summon" }).name).toBe("listening");
  });

  it("startWorking: → working with a step label", () => {
    const next = orbReducer(at("responding"), { type: "startWorking", step: "Opening Finder" });
    expect(next.name).toBe("working");
    expect(next.workingStep).toBe("Opening Finder");
  });

  it("workingStep updates the label without leaving working", () => {
    const next = orbReducer(at("working"), { type: "workingStep", step: "Selecting files" });
    expect(next.name).toBe("working");
    expect(next.workingStep).toBe("Selecting files");
  });

  it("stop: working → responding (shows partial result)", () => {
    expect(orbReducer(at("working"), { type: "stop" }).name).toBe("responding");
  });

  it("dismiss: any state → dormant and resets transient fields", () => {
    const busy: OrbState = { name: "responding", transcript: "x", responseText: "y", workingStep: "z", error: null };
    const next = orbReducer(busy, { type: "dismiss" });
    expect(next).toEqual(INITIAL_ORB_STATE);
  });

  it("error: → dormant with an error message", () => {
    const next = orbReducer(at("processing"), { type: "error", message: "STT failed" });
    expect(next.name).toBe("dormant");
    expect(next.error).toBe("STT failed");
  });

  it("ignores summon when not dormant", () => {
    expect(orbReducer(at("processing"), { type: "summon" }).name).toBe("processing");
  });
});
