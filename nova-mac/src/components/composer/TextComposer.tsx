import { useRef, useState } from "react";
import { nova } from "../../lib/ipc";

interface TextComposerProps {
  onSend?: (text: string) => void;
}

export function TextComposer({ onSend }: TextComposerProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onSend) {
      // Parent owns the turn (streams the reply into the panel).
      onSend(trimmed);
    } else {
      nova().chatSend({
        requestId: `text-${Date.now()}`,
        messages: [{ role: "user", content: trimmed }],
        inputModality: "text",
      });
    }
    setText("");
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "11px 18px",
        background: "rgba(255,255,255,0.1)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 9999,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
        margin: "0 12px 12px",
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        placeholder="Type a message…"
        style={{
          flex: 1,
          background: "none",
          border: "none",
          outline: "none",
          color: "rgba(255,255,255,0.92)",
          fontSize: 14.5,
          minWidth: 0,
        }}
      />
      <button
        onClick={send}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "rgba(10,132,255,0.9)" : "rgba(255,255,255,0.1)",
          border: "none",
          borderRadius: 9999,
          color: "white",
          cursor: text.trim() ? "pointer" : "default",
          fontSize: 14,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
      >
        ↵
      </button>
    </div>
  );
}
