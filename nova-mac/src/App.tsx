import { useEffect, useRef, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { useVoice } from "./hooks/useVoice";
import { Orb } from "./components/orb/Orb";

function VoiceApp() {
  const { state, level, sendText } = useVoice();
  const [expanded, setExpanded] = useState(false);
  // True when WE grew the window for a timer notice — that collapses back to
  // the mini orb on its own. Click-opened panels stay open. Speaking, thinking,
  // and barge-in never auto-expand — the orb's own color communicates state
  // (grey/purple/green/orange) while it stays a corner orb.
  const autoExpandedRef = useRef(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => nova().onOrbExpandedChanged(setExpanded), []);

  const hasNotice = state.notice !== null;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    if (hasNotice) {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }
      if (!expandedRef.current) {
        autoExpandedRef.current = true;
        nova().orbSetExpanded(true); // system-driven: main auto-hides after
      }
    } else if (autoExpandedRef.current) {
      // Give the user a moment to read, then tuck back into the corner
      // (main hides the whole window once this collapse lands).
      collapseTimer.current = setTimeout(() => {
        collapseTimer.current = null;
        autoExpandedRef.current = false;
        nova().orbSetExpanded(false);
      }, 2500);
    }
  }, [hasNotice]);

  // One always-mounted Orb: the orb itself never remounts or moves across
  // expand/collapse — clicking it toggles the chat chrome around it.
  return (
    <Orb
      state={state}
      level={level}
      expanded={expanded}
      onSend={sendText}
      onOrbClick={() => {
        autoExpandedRef.current = false;
        nova().orbSetExpanded(!expanded, true); // manual: open stays, collapse doesn't vanish
      }}
      onCollapse={() => {
        autoExpandedRef.current = false;
        nova().orbSetExpanded(false, true); // manual: collapses, doesn't vanish
      }}
      onExpand={() => nova().appOpen()}
    />
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    nova().authStatus().then(setAuth).catch((e) => setStatus(`auth check failed: ${e?.message ?? e}`));
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  // The sign-in card needs the full panel visible — force it manually since
  // the orb window is otherwise hidden until something activates it.
  useEffect(() => {
    if (!auth.signedIn) nova().orbSetExpanded(true, true);
  }, [auth.signedIn]);

  if (!auth.signedIn) {
    const sendLink = () => {
      setStatus("Sending magic link…");
      nova()
        .authSignIn(email)
        .then(() => setStatus(`Magic link sent to ${email}. Check your email, then return here.`))
        .catch((e) => setStatus(`Sign-in failed: ${e?.message ?? e}`));
    };
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24, boxSizing: "border-box" }}>
        <div className="nova-glass nova-card" style={{ padding: 24, width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Sign in to Nova</div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "white", fontSize: 14, outline: "none" }}
          />
          <button
            onClick={sendLink}
            style={{ padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "rgba(10,132,255,0.95)", color: "white", fontSize: 14, fontWeight: 600 }}
          >
            Send magic link
          </button>
          {status && <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>}
        </div>
      </div>
    );
  }

  return <VoiceApp />;
}
