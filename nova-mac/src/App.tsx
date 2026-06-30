import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { useOrb } from "./hooks/useOrb";
import { Orb } from "./components/orb/Orb";
import { ChatSheet } from "./components/sheet/ChatSheet";

function OrbHarness({ email }: { email: string | null }) {
  const { state, dispatch } = useOrb();
  const [level, setLevel] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // DEV ONLY: drive states from the keyboard until voice (Task 12) is wired.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") dispatch({ type: "summon" });
      if (e.key === "2") dispatch({ type: "submit", transcript: "demo command" });
      if (e.key === "3") { dispatch({ type: "responseStart" });
        dispatch({ type: "responseDelta", delta: "This is a demo response from Nova." }); }
      if (e.key === "4") dispatch({ type: "responseEnd" });
      if (e.key === "5") dispatch({ type: "startWorking", step: "Opening Finder" });
      if (e.key === "Escape") { dispatch({ type: "dismiss" }); setSheetOpen(false); }
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
        onExpand={() => setSheetOpen(true)}
      />
      <ChatSheet
        open={sheetOpen}
        messages={[
          { role: "user", content: "demo command" },
          { role: "assistant", content: "This is a demo response from Nova." },
        ]}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    nova()
      .authStatus()
      .then(setAuth)
      .catch((e) => setStatus(`auth check failed: ${e?.message ?? e}`));
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    const sendLink = () => {
      setStatus("Sending magic link…");
      nova()
        .authSignIn(email)
        .then(() => setStatus(`Magic link sent to ${email}. Check your email, then return here.`))
        .catch((e) => setStatus(`Sign-in failed: ${e?.message ?? e}`));
    };
    return (
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", padding: 24, boxSizing: "border-box",
        }}
      >
        <div
          className="nova-glass nova-card"
          style={{ padding: 24, width: 300, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ fontSize: 18, fontWeight: 600 }}>Sign in to Nova</div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
            style={{
              padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.25)", color: "white", fontSize: 14, outline: "none",
            }}
          />
          <button
            onClick={sendLink}
            style={{
              padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer",
              background: "rgba(10,132,255,0.95)", color: "white", fontSize: 14, fontWeight: 600,
            }}
          >
            Send magic link
          </button>
          {status && <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>}
        </div>
      </div>
    );
  }

  return <OrbHarness email={auth.email} />;
}
