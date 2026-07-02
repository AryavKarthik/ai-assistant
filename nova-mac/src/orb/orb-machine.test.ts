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

  it("summon: bargeIn → stays bargeIn (orange persists through the follow-up recording)", () => {
    expect(orbReducer(at("bargeIn"), { type: "summon" }).name).toBe("bargeIn");
  });

  it("submit: bargeIn → processing (follow-up utterance transcribed)", () => {
    const next = orbReducer(at("bargeIn"), { type: "submit", transcript: "what about tomorrow" });
    expect(next.name).toBe("processing");
    expect(next.transcript).toBe("what about tomorrow");
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
    const busy: OrbState = { name: "responding", transcript: "x", responseText: "y", workingStep: "z", error: null, notice: null };
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

  it("responseDelta while working returns to responding and appends", () => {
    const next = orbReducer(
      { ...at("working"), workingStep: "Checking your calendar…" },
      { type: "responseDelta", delta: "You have" },
    );
    expect(next.name).toBe("responding");
    expect(next.workingStep).toBeNull();
    expect(next.responseText).toBe("You have");
  });

  it("responseEnd while working returns to dormant (tool-only turn)", () => {
    expect(orbReducer(at("working"), { type: "responseEnd" }).name).toBe("dormant");
  });

  it("bargeIn while working resets to bargeIn", () => {
    expect(orbReducer(at("working"), { type: "bargeIn" }).name).toBe("bargeIn");
  });

  it("settle: responding → dormant but keeps the conversation text", () => {
    const busy: OrbState = { ...at("responding"), transcript: "hi", responseText: "hello!" };
    const next = orbReducer(busy, { type: "settle" });
    expect(next.name).toBe("dormant");
    expect(next.transcript).toBe("hi");
    expect(next.responseText).toBe("hello!");
    // next summon clears the settled text
    expect(orbReducer(next, { type: "summon" }).responseText).toBe("");
  });

  it("notice shows only while dormant and dismiss clears it", () => {
    const next = orbReducer(at("dormant"), { type: "notice", message: "Timer done — Pasta" });
    expect(next.notice).toBe("Timer done — Pasta");
    expect(orbReducer(at("listening"), { type: "notice", message: "x" }).notice).toBeNull();
    expect(orbReducer(next, { type: "dismiss" })).toEqual(INITIAL_ORB_STATE);
  });
});
