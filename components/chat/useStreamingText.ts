"use client";

import { useEffect, useRef, useState } from "react";

interface UseStreamingTextOptions {
  onTick?: () => void;
  onComplete?: () => void;
}

const MS_PER_CHAR = 9;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useStreamingText(
  text: string,
  enabled: boolean,
  { onTick, onComplete }: UseStreamingTextOptions = {},
) {
  const [visibleLength, setVisibleLength] = useState(text.length);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (prefersReducedMotion() || !text.length) {
      const timer = window.setTimeout(() => {
        setVisibleLength(text.length);
        onComplete?.();
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const startTimer = window.setTimeout(() => {
      setVisibleLength(0);
    }, 0);
    let index = 0;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const elapsed = now - last;
      const add = Math.max(1, Math.floor(elapsed / MS_PER_CHAR));
      last = now;
      index = Math.min(text.length, index + add);
      setVisibleLength(index);
      onTick?.();

      if (index < text.length) {
        raf = requestAnimationFrame(step);
      } else {
        onComplete?.();
      }
    };

    raf = requestAnimationFrame(step);
    return () => {
      window.clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [text, enabled, onTick, onComplete]);

  if (!enabled) {
    return text;
  }

  return text.slice(0, visibleLength);
}

/** Types newly appended characters without restarting when `text` grows. */
export function useCatchUpText(
  text: string,
  enabled: boolean,
  { onTick, onComplete }: UseStreamingTextOptions = {},
) {
  const [visibleLength, setVisibleLength] = useState(() => (enabled ? 0 : text.length));
  const visibleRef = useRef(visibleLength);
  const prevTextRef = useRef(text);

  useEffect(() => {
    visibleRef.current = visibleLength;
  }, [visibleLength]);

  useEffect(() => {
    if (!enabled) {
      setVisibleLength(text.length);
      visibleRef.current = text.length;
      prevTextRef.current = text;
      return;
    }

    if (prefersReducedMotion()) {
      setVisibleLength(text.length);
      visibleRef.current = text.length;
      prevTextRef.current = text;
      onComplete?.();
      return;
    }

    const prevText = prevTextRef.current;
    let start = visibleRef.current;

    if (
      text.length < start ||
      (start > 0 && !text.startsWith(prevText.slice(0, Math.min(start, prevText.length))))
    ) {
      start = 0;
    }

    prevTextRef.current = text;
    const target = text.length;

    if (start >= target) {
      setVisibleLength(target);
      visibleRef.current = target;
      if (target > 0) onComplete?.();
      return;
    }

    let index = start;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const elapsed = now - last;
      const add = Math.max(1, Math.floor(elapsed / MS_PER_CHAR));
      last = now;
      index = Math.min(target, index + add);
      visibleRef.current = index;
      setVisibleLength(index);
      onTick?.();

      if (index < target) {
        raf = requestAnimationFrame(step);
      } else {
        onComplete?.();
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, enabled, onTick, onComplete]);

  if (!enabled) {
    return text;
  }

  return text.slice(0, visibleLength);
}
