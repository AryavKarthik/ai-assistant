"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  normalizeAssistantMarkdown,
  stabilizeStreamingMarkdown,
} from "@/lib/chat/format-message";
import { useStreamingText } from "./useStreamingText";

interface AssistantMessageContentProps {
  text: string;
  streaming?: boolean;
  onTick?: () => void;
  onComplete?: () => void;
}

const markdownComponents: Components = {
  h2: ({ children }) => <h2 className="app-msg-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="app-msg-h3">{children}</h3>,
  p: ({ children }) => <p className="app-msg-p">{children}</p>,
  ul: ({ children }) => <ul className="app-msg-ul">{children}</ul>,
  ol: ({ children }) => <ol className="app-msg-ol">{children}</ol>,
  li: ({ children }) => <li className="app-msg-li">{children}</li>,
  strong: ({ children }) => <strong className="app-msg-strong">{children}</strong>,
  em: ({ children }) => <em className="app-msg-em">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="app-msg-callout">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={`app-msg-code-block ${className ?? ""}`}>{children}</code>;
    }
    return <code className="app-msg-code">{children}</code>;
  },
  pre: ({ children }) => <pre className="app-msg-pre">{children}</pre>,
  a: ({ href, children }) => (
    <a
      className="app-msg-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="app-msg-table-wrap">
      <table className="app-msg-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="app-msg-thead">{children}</thead>,
  tbody: ({ children }) => <tbody className="app-msg-tbody">{children}</tbody>,
  tr: ({ children }) => <tr className="app-msg-tr">{children}</tr>,
  th: ({ children }) => <th className="app-msg-th">{children}</th>,
  td: ({ children }) => <td className="app-msg-td">{children}</td>,
  hr: () => <hr className="app-msg-hr" />,
};

export function AssistantMessageContent({
  text,
  streaming = false,
  onTick,
  onComplete,
}: AssistantMessageContentProps) {
  const visible = useStreamingText(text, streaming, { onTick, onComplete });
  const source = streaming
    ? stabilizeStreamingMarkdown(visible)
    : normalizeAssistantMarkdown(visible);
  const showCursor = streaming && visible.length < text.length;

  return (
    <div className="app-message-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {source}
      </ReactMarkdown>
      {showCursor ? (
        <span className="app-stream-cursor" aria-hidden>
          ▍
        </span>
      ) : null}
    </div>
  );
}
