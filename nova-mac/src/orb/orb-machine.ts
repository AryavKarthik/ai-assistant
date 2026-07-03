import type { OrbStateName } from "@shared/types";

export interface OrbState {
  name: OrbStateName;
  transcript: string;
  responseText: string;
  workingStep: string | null;
  error: string | null;
  /** Transient announcement (e.g. a timer firing) shown without a voice turn. */
  notice: string | null;
}

export type OrbEvent =
  | { type: "summon" }
  | { type: "submit"; transcript: string }
  | { type: "responseStart" }
  | { type: "responseDelta"; delta: string }
  | { type: "responseEnd" }
  | { type: "settle" }
  | { type: "bargeIn" }
  | { type: "startWorking"; step: string }
  | { type: "workingStep"; step: string }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

export const INITIAL_ORB_STATE: OrbState = {
  name: "dormant",
  transcript: "",
  responseText: "",
  workingStep: null,
  error: null,
  notice: null,
};

export function orbReducer(state: OrbState, event: OrbEvent): OrbState {
  switch (event.type) {
    case "summon":
      // Coming from a fresh wake word: go to listening (its own blue color,
      // distinct from the grey "at rest" idle look).
      // Coming from a barge-in: STAY bargeIn (orange) through the follow-up
      // recording — runTurn() dispatches summon right after bargeIn in the same
      // tick, and React batches both into one render, so if we reset to
      // "listening" here the orange state is never actually visible.
      if (state.name === "dormant") return { ...INITIAL_ORB_STATE, name: "listening" };
      if (state.name === "bargeIn") return { ...INITIAL_ORB_STATE, name: "bargeIn" };
      return state;

    case "submit":
      return state.name === "listening" || state.name === "bargeIn"
        ? { ...state, name: "processing", transcript: event.transcript, error: null }
        : state;

    case "responseStart":
      return state.name === "processing" || state.name === "working"
        ? { ...state, name: "responding", workingStep: null, responseText: "" }
        : state;

    case "responseDelta":
      // Tool finished and text resumed — leave "working" automatically.
      if (state.name === "working") {
        return {
          ...state,
          name: "responding",
          workingStep: null,
          responseText: state.responseText + event.delta,
        };
      }
      return state.name === "responding"
        ? { ...state, responseText: state.responseText + event.delta }
        : state;

    case "responseEnd":
      return state.name === "responding" || state.name === "working"
        ? { ...INITIAL_ORB_STATE, name: "dormant" }
        : state;

    // Turn finished but keep the conversation text on screen (chat panel).
    // The next summon/submit clears it.
    case "settle":
      return state.name === "responding" || state.name === "working"
        ? { ...state, name: "dormant", workingStep: null }
        : state;

    case "bargeIn":
      return state.name === "responding" || state.name === "working"
        ? { ...INITIAL_ORB_STATE, name: "bargeIn" }
        : state;

    case "startWorking":
      return state.name === "processing" || state.name === "responding" || state.name === "working"
        ? { ...state, name: "working", workingStep: event.step }
        : state;

    case "workingStep":
      return state.name === "working" ? { ...state, workingStep: event.step } : state;

    case "stop":
      return state.name === "working" ? { ...state, name: "responding", workingStep: null } : state;

    case "dismiss":
      return INITIAL_ORB_STATE;

    case "notice":
      return state.name === "dormant"
        ? { ...INITIAL_ORB_STATE, notice: event.message }
        : state;

    case "error":
      return { ...INITIAL_ORB_STATE, name: "dormant", error: event.message };
  }
}
