import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { useOrb } from "./hooks/useOrb";
import { Orb } from "./components/orb/Orb";

function OrbHarness({ email }: { email: string | null }) {
  const { state, dispatch } = useOrb();
  const [level, setLevel] = useState(0);

  // DEV ONLY: drive states from the keyboard until voice (Task 12) is wired.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") dispatch({ type: "summon" });
      if (e.key === "2") dispatch({ type: "submit", transcript: "demo command" });
      if (e.key === "3") { dispatch({ type: "responseStart" });
        dispatch({ type: "responseDelta", delta: "This is a demo response from Nova." }); }
      if (e.key === "4") dispatch({ type: "responseEnd" });
      if (e.key === "5") dispatch({ type: "startWorking", step: "Opening Finder" });
      if (e.key === "Escape") dispatch({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    const t = setInterval(() => setLevel(Math.random() * 0.6), 120);
    return () => { window.removeEventListener("keydown", onKey); clearInterval(t); };
  }, [dispatch]);

  return (
    <>
      <div style={{ position: "fixed", top: 8, left: 8, fontSize: 10, opacity: 0.4 }}>
        {email} · keys 1–5 / Esc
      </div>
      <Orb
        state={state}
        level={level}
        onSummon={() => dispatch({ type: "summon" })}
        onStop={() => dispatch({ type: "stop" })}
      />
    </>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");

  useEffect(() => {
    nova().authStatus().then(setAuth);
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    return (
      <div style={{ color: "white", padding: 16 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
        <button onClick={() => nova().authSignIn(email)}>Send magic link</button>
      </div>
    );
  }

  return <OrbHarness email={auth.email} />;
}
