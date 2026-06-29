import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState, ConversationSummary, MemorySummary } from "@shared/types";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");
  const [convos, setConvos] = useState<ConversationSummary[]>([]);
  const [mems, setMems] = useState<MemorySummary[]>([]);

  useEffect(() => {
    nova().authStatus().then(setAuth);
    nova().onAuthChanged(setAuth);
  }, []);

  useEffect(() => {
    if (!auth.signedIn) return;
    nova().syncConversations().then(setConvos);
    nova().syncMemories().then(setMems);
  }, [auth.signedIn]);

  if (!auth.signedIn) {
    return (
      <div style={{ color: "white", padding: 16 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
        <button onClick={() => nova().authSignIn(email)}>Send magic link</button>
      </div>
    );
  }

  return (
    <div style={{ color: "white", padding: 16 }}>
      <div>Signed in as {auth.email}</div>
      <div>{convos.length} conversations · {mems.length} memories</div>
    </div>
  );
}
