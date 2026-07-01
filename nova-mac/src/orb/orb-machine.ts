import type { OrbStateName } from "@shared/types";

export interface OrbState {
  name: OrbStateName;
  transcript: string;
  responseText: string;
  workingStep: string | null;
  error: string | null;
}

export type OrbEvent =
  | { type: "summon" }
  | { type: "submit"; transcript: string }
  | { type: "responseStart" }
  | { type: "responseDelta"; delta: string }
  | { type: "responseEnd" }
  | { type: "bargeIn" }
  | { type: "startWorking"; step: string }
  | { type: "workingStep"; step: string }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "error"; message: string };

export const INITIAL_ORB_STATE: OrbState = {
  name: "dormant",
  transcript: "",
  responseText: "",
  workingStep: null,
  error: null,
};

export function orbReducer(state: OrbState, event: OrbEvent): OrbState {
  switch (event.type) {
    case "summon":
      return state.name === "dormant" || state.name === "bargeIn"
        ? { ...INITIAL_ORB_STATE, name: "listening" }
        : state;

    case "submit":
      return state.name === "listening"
        ? { ...state, name: "processing", transcript: event.transcript, error: null }
        : state;

    case "responseStart":
      return state.name === "processing"
        ? { ...state, name: "responding", responseText: "" }
        : state;

    case "responseDelta":
      return state.name === "responding"
        ? { ...state, responseText: state.responseText + event.delta }
        : state;

    case "responseEnd":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "dormant" }
        : state;

    case "bargeIn":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "bargeIn" }
        : state;

    case "startWorking":
      return { ...state, name: "working", workingStep: event.step };

    case "workingStep":
      return state.name === "working" ? { ...state, workingStep: event.step } : state;

    case "stop":
      return state.name === "working" ? { ...state, name: "responding" } : state;

    case "dismiss":
      return INITIAL_ORB_STATE;

    case "error":
      return { ...INITIAL_ORB_STATE, name: "dormant", error: event.message };
  }
}
