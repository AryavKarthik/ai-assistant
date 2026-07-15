import type { ReactNode } from "react";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export interface LinkSegment {
  type: "text" | "link";
  value: string;
}

/** Split text into plain and URL segments. Trailing sentence punctuation is
 *  kept out of the URL so "…watch?v=abc." doesn't produce a broken link. */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trailing = url.match(/[.,;:!?]+$/);
    if (trailing) url = url.slice(0, -trailing[0].length);
    const start = m.index;
    if (start > last) segments.push({ type: "text", value: text.slice(last, start) });
    segments.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

/** Render reply text with URLs as clickable links. Anchor clicks are routed
 *  to the default browser by main's window-open/will-navigate handlers
 *  (window.ts) — without those the click would navigate the Electron window
 *  itself away from the app. */
export function linkifyText(text: string): ReactNode[] {
  return splitLinks(text).map((seg, i) =>
    seg.type === "link" ? (
      <a
        key={i}
        href={seg.value}
        target="_blank"
        rel="noreferrer"
        style={{ color: "#8ab4ff", textDecorationColor: "rgba(138,180,255,0.5)" }}
      >
        {seg.value}
      </a>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  );
}
