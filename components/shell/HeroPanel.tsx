"use client";

import { AnimatePresence, motion } from "motion/react";
import { appIconClass, IconCamera, IconKeyboard } from "./icons";
import { WaveLoader } from "@/components/ui/loader";

interface HeroPanelProps {
  isLoading: boolean;
  onFocusInput: () => void;
  onAttachImage: () => void;
}

export function HeroPanel({
  isLoading,
  onFocusInput,
  onAttachImage,
}: HeroPanelProps) {
  return (
    <section className="app-center">
      <div className="app-rings">
        <div className="app-rings-visual">
          <div className="app-ring app-ring-1" />
          <div className="app-ring app-ring-2" />
          <div className="app-ring app-ring-3" />
          <div className="app-ring app-ring-4" />
          <div className="app-rings-core">
            <AnimatePresence mode="wait" initial={false}>
              {isLoading ? (
                <motion.div
                  key="wave"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="z-10"
                >
                  <WaveLoader
                    size="md"
                    className="[&_div]:bg-[#9a9a9a]"
                  />
                </motion.div>
              ) : (
                <motion.span
                  key="idle"
                  className="app-rings-idle"
                  aria-hidden
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <h2 className="app-center-title">Assistant</h2>

      <div className="app-center-status">
        <span className="app-pill">
          <span className="app-pill-dot" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isLoading ? "thinking" : "ready"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {isLoading ? "Thinking…" : "Ready"}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>

      <div className="app-center-controls">
        <button
          type="button"
          className="app-icon-btn"
          aria-label="Attach image"
          onClick={onAttachImage}
        >
          <IconCamera className={appIconClass} />
        </button>
        <button
          type="button"
          className="app-icon-btn active"
          aria-label="Focus input"
          onClick={onFocusInput}
        >
          <IconKeyboard className={appIconClass} />
        </button>
      </div>
    </section>
  );
}
