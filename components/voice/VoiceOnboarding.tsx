"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";

const STORAGE_KEY = "assistant.voice.onboarded";

interface VoiceOnboardingProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Hold to talk",
    body: "Press and hold the mic button to record a message. Release to send.",
  },
  {
    title: "Conversation mode",
    body: "Tap the mic once to stay in voice mode. I'll listen after each reply.",
  },
  {
    title: "Wake word",
    body: 'Enable wake word in Voice settings and say "Hey Nova" to start hands-free. Works in Chrome, Edge, and Safari.',
  },
];

function persistDismissed() {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, "1");
  }
}

export function VoiceOnboarding({ open, onClose }: VoiceOnboardingProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  const dismiss = () => {
    persistDismissed();
    onClose();
  };

  return (
    <div
      className="app-voice-modal-backdrop app-voice-onboarding-backdrop"
      role="dialog"
      aria-label="Voice onboarding"
      onClick={dismiss}
    >
      <div
        className="app-voice-onboarding-card"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="app-voice-onboarding-step">
          {step + 1} / {STEPS.length}
        </p>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="app-voice-onboarding-actions">
          <Button type="button" variant="ghost" onClick={dismiss}>
            Skip
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (isLast) {
                dismiss();
              } else {
                setStep((s) => s + 1);
              }
            }}
          >
            {isLast ? "Got it" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function shouldShowVoiceOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== "1";
}
