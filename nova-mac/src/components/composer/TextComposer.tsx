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
    const id = `text-${Date.now()}`;
    nova().chatSend({
      requestId: id,
      messages: [{ role: "user", content: trimmed }],
      inputModality: "text",
    });
    onSend?.(trimmed);
    setText("");
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        margin: "0 16px 16px",
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
          color: "rgba(255,255,255,0.88)",
          fontSize: 14,
          minWidth: 0,
        }}
      />
      <button
        onClick={send}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "rgba(10,132,255,0.9)" : "rgba(255,255,255,0.1)",
          border: "none",
          borderRadius: 8,
          color: "white",
          cursor: text.trim() ? "pointer" : "default",
          fontSize: 14,
          padding: "4px 10px",
          transition: "background 0.15s",
        }}
      >
        ↵
      </button>
    </div>
  );
}
