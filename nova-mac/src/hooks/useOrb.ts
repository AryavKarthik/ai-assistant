import { useReducer } from "react";
import { orbReducer, INITIAL_ORB_STATE, type OrbEvent } from "../orb/orb-machine";

export function useOrb() {
  const [state, dispatch] = useReducer(orbReducer, INITIAL_ORB_STATE);
  return { state, dispatch: (e: OrbEvent) => dispatch(e) };
}
