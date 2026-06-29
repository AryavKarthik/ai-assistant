"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadVoicePreferences,
  saveVoicePreferences,
} from "@/lib/voice/preferences";
import { unlockAudioPlayback } from "@/lib/voice/audio-unlock";
import {
  TtsBargeInListener,
  ttsBargeInConfigFromSensitivity,
} from "@/lib/voice/tts-barge-in";
import { playThinkingEarcon, playWakeEarcon } from "@/lib/voice/earcon";
import { speechGateOptionsFromSensitivity } from "@/lib/voice/gate-options";
import { MicSession } from "@/lib/voice/mic-session";
import { VoicePlayer, type StreamingVoiceSession } from "@/lib/voice/player";
import { VoiceRecorder } from "@/lib/voice/recorder";
import { isGarbageTranscript } from "@/lib/voice/transcript-filter";
import { isVoiceStopPhrase } from "@/lib/voice/stop-phrases";
import {
  isWakeWordSupported,
  startWakeWord,
  stopWakeWord,
} from "@/lib/voice/wake";
import {
  DEFAULT_VOICE_PREFERENCES,
  type VoiceInteractionMode,
  type VoicePreferences,
  type VoiceSessionState,
} from "@/lib/voice/types";

const EMPTY_RESUME_MS = 150;

interface BargeInProbeState {
  active: boolean;
  heardSpeech: boolean;
  pushToTalk: boolean;
  timer: number | null;
  suspendedTts: boolean;
}

type TranscriptOutcome = "stopped" | "sent" | "empty";

export type BargeInOptions = {
  keepVoiceSession?: boolean;
};

export interface UseVoiceSessionOptions {
  disabled: boolean;
  isAssistantBusy: boolean;
  isAssistantStreaming: boolean;
  hasImageAttachment: boolean;
  onSendTranscript: (text: string) => Promise<void> | void;
  onBargeIn: (options?: BargeInOptions) => void;
}

export function useVoiceSession({
  disabled,
  isAssistantBusy,
  isAssistantStreaming,
  hasImageAttachment,
  onSendTranscript,
  onBargeIn,
}: UseVoiceSessionOptions) {
  const [preferences, setPreferences] = useState<VoicePreferences>(() =>
    typeof window === "undefined"
      ? DEFAULT_VOICE_PREFERENCES
      : loadVoicePreferences(),
  );
  const [sessionState, setSessionState] = useState<VoiceSessionState>("idle");
  const [statusText, setStatusText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [bargeInActive, setBargeInActive] = useState(false);
  const [passiveWakeListening, setPassiveWakeListening] = useState(false);
  /** Active voice session (overlay open). Wake word preference can listen passively without this. */
  const [voiceArmed, setVoiceArmed] = useState(false);
  const voiceArmedRef = useRef(false);

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  const ttsBargeInRef = useRef<TtsBargeInListener | null>(null);
  const streamingReplyRef = useRef<StreamingVoiceSession | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const processingTurnRef = useRef(false);
  const pushToTalkActiveRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const lastSentRef = useRef("");
  const sessionStateRef = useRef<VoiceSessionState>("idle");
  const assistantActiveRef = useRef(false);
  const disabledRef = useRef(false);
  const onBargeInRef = useRef(onBargeIn);
  const onSendRef = useRef(onSendTranscript);
  const preferencesRef = useRef(preferences);
  const finishConversationTurnRef = useRef<() => void>(() => {});
  const resumeAfterAssistantTurnRef =
    useRef<(options?: { force?: boolean }) => boolean>(() => false);
  const executeBargeInRef =
    useRef<(options?: { pushToTalk?: boolean }) => boolean>(() => false);
  const markBargeInSpeechRef = useRef<() => void>(() => {});
  const abortBargeInProbeRef = useRef<() => void>(() => {});
  const startTtsBargeInRef = useRef<() => void>(() => {});
  const bargeInProbeRef = useRef<BargeInProbeState>({
    active: false,
    heardSpeech: false,
    pushToTalk: false,
    timer: null,
    suspendedTts: false,
  });
  const interruptCaptureRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const wakeWordRunningRef = useRef(false);
  const wakeWordStartingRef = useRef(false);
  const micSessionRef = useRef(new MicSession());
  const emptyResumeTimerRef = useRef<number | null>(null);
  const statusClearTimerRef = useRef<number | null>(null);
  const sendGenerationRef = useRef(0);

  const assistantActive = isAssistantBusy || isAssistantStreaming;

  const conversationMode =
    voiceArmed && preferences.interactionMode === "conversation";
  const wakeWordPreference = preferences.interactionMode === "wake_word";
  const wakeWordMode = wakeWordPreference;
  const voiceActive =
    voiceArmed &&
    (preferences.interactionMode === "conversation" ||
      preferences.interactionMode === "wake_word" ||
      sessionState !== "idle" ||
      isSpeaking ||
      assistantActive);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    voiceArmedRef.current = voiceArmed;
  }, [voiceArmed]);

  useEffect(() => {
    assistantActiveRef.current = assistantActive;
    disabledRef.current = disabled;
    onBargeInRef.current = onBargeIn;
    onSendRef.current = onSendTranscript;
    preferencesRef.current = preferences;
  }, [assistantActive, disabled, onBargeIn, onSendTranscript, preferences]);

  useEffect(() => {
    playerRef.current ??= new VoicePlayer();
    return () => {
      playerRef.current?.stop();
    };
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingSeconds(0);
  }, []);

  const startRecordingTimer = useCallback(() => {
    clearRecordingTimer();
    setRecordingSeconds(0);
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
  }, [clearRecordingTimer]);

  const disposeRecorderOnly = useCallback((keepMic = false) => {
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    recorderRef.current?.dispose({ keepStream: keepMic });
    recorderRef.current = null;
    if (!keepMic) {
      micSessionRef.current.release();
    }
    clearRecordingTimer();
  }, [clearRecordingTimer]);

  const clearVoiceTimers = useCallback(() => {
    if (emptyResumeTimerRef.current !== null) {
      window.clearTimeout(emptyResumeTimerRef.current);
      emptyResumeTimerRef.current = null;
    }
    if (statusClearTimerRef.current !== null) {
      window.clearTimeout(statusClearTimerRef.current);
      statusClearTimerRef.current = null;
    }
  }, []);

  const abortActiveCapture = useCallback(
    (keepStream = true) => {
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      recorderRef.current?.dispose({ keepStream });
      recorderRef.current = null;
      clearRecordingTimer();
      setAudioLevel(0);
    },
    [clearRecordingTimer],
  );

  const stopWakeWordListener = useCallback(() => {
    void stopWakeWord();
    wakeWordRunningRef.current = false;
    setPassiveWakeListening(false);
  }, []);

  const releaseMic = useCallback(() => {
    clearVoiceTimers();
    disposeRecorderOnly(false);
    setAudioLevel(0);
  }, [clearVoiceTimers, disposeRecorderOnly]);

  const stopTtsBargeIn = useCallback(() => {
    ttsBargeInRef.current?.stop();
    ttsBargeInRef.current = null;
  }, []);

  const clearBargeInProbeTimer = useCallback(() => {
    if (bargeInProbeRef.current.timer !== null) {
      window.clearTimeout(bargeInProbeRef.current.timer);
      bargeInProbeRef.current.timer = null;
    }
  }, []);

  const resetBargeInProbe = useCallback(() => {
    clearBargeInProbeTimer();
    bargeInProbeRef.current = {
      active: false,
      heardSpeech: false,
      pushToTalk: false,
      timer: null,
      suspendedTts: false,
    };
    interruptCaptureRef.current = false;
    setBargeInActive(false);
  }, [clearBargeInProbeTimer]);

  const hardStopAssistantAudio = useCallback(() => {
    stopTtsBargeIn();
    const session = streamingReplyRef.current;
    streamingReplyRef.current = null;
    if (session) {
      session.stop();
    } else {
      playerRef.current?.stop();
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, [stopTtsBargeIn]);

  const abortBargeInProbe = useCallback(async () => {
    if (!bargeInProbeRef.current.active || bargeInProbeRef.current.heardSpeech) {
      resetBargeInProbe();
      return;
    }

    const shouldResume = bargeInProbeRef.current.suspendedTts;
    resetBargeInProbe();
    pushToTalkActiveRef.current = false;

    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    recorderRef.current?.dispose({ keepStream: true });
    recorderRef.current = null;
    clearRecordingTimer();
    setAudioLevel(0);

    if (shouldResume) {
      try {
        await playerRef.current?.resumePlayback();
      } catch {
        // ignore
      }
      if (playerRef.current?.isPlaying() || playerRef.current?.isSuspended()) {
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setSessionState("assistant_speaking");
        setStatusText("");
        startTtsBargeInRef.current();
        return;
      }
    }

    setSessionState(assistantActiveRef.current ? "assistant_streaming" : "idle");
    setStatusText("");
  }, [clearRecordingTimer, resetBargeInProbe]);

  const markBargeInSpeech = useCallback(() => {
    if (!bargeInProbeRef.current.active) return;
    bargeInProbeRef.current.heardSpeech = true;
    clearBargeInProbeTimer();
    if (!bargeInProbeRef.current.pushToTalk) {
      hardStopAssistantAudio();
      bargeInProbeRef.current.suspendedTts = false;
    }
  }, [clearBargeInProbeTimer, hardStopAssistantAudio]);

  const resumeSuspendedTts = useCallback(async () => {
    const shouldResume = bargeInProbeRef.current.suspendedTts;
    resetBargeInProbe();
    pushToTalkActiveRef.current = false;

    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    recorderRef.current?.dispose({ keepStream: true });
    recorderRef.current = null;
    clearRecordingTimer();
    setAudioLevel(0);

    if (!shouldResume) {
      setSessionState(assistantActiveRef.current ? "assistant_streaming" : "idle");
      setStatusText("");
      return;
    }

    try {
      await playerRef.current?.resumePlayback();
    } catch {
      // ignore
    }
    if (playerRef.current?.isPlaying() || playerRef.current?.isSuspended()) {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      setSessionState("assistant_speaking");
      setStatusText("");
      startTtsBargeInRef.current();
      return;
    }

    setSessionState(assistantActiveRef.current ? "assistant_streaming" : "idle");
    setStatusText("");
  }, [clearRecordingTimer, resetBargeInProbe]);

  const stopSpeaking = useCallback(() => {
    resetBargeInProbe();
    interruptCaptureRef.current = false;
    pushToTalkActiveRef.current = false;
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    recorderRef.current?.dispose({ keepStream: true });
    recorderRef.current = null;
    clearRecordingTimer();
    setAudioLevel(0);
    stopTtsBargeIn();
    streamingReplyRef.current?.stop();
    streamingReplyRef.current = null;
    playerRef.current?.stop();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    if (!assistantActiveRef.current && sessionStateRef.current === "assistant_speaking") {
      setSessionState("idle");
    }
  }, [clearRecordingTimer, resetBargeInProbe, stopTtsBargeIn]);

  const sendTranscript = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGarbageTranscript(trimmed)) return;
    if (disabledRef.current) return;

    const wasInterrupt = interruptCaptureRef.current;
    if (sendInFlightRef.current && !wasInterrupt) {
      const conversationLike =
        preferencesRef.current.interactionMode === "conversation" ||
        preferencesRef.current.interactionMode === "wake_word";
      if (conversationLike) {
        onBargeInRef.current({ keepVoiceSession: true });
      } else {
        return;
      }
    }
    if (trimmed === lastSentRef.current && !wasInterrupt) return;

    const sendGeneration = ++sendGenerationRef.current;

    if (wasInterrupt) {
      hardStopAssistantAudio();
      onBargeInRef.current({ keepVoiceSession: true });
    }

    sendInFlightRef.current = true;
    lastSentRef.current = trimmed;
    resetBargeInProbe();
    disposeRecorderOnly(true);
    setAudioLevel(0);
    setSessionState("sending");
    setStatusText("");

    try {
      await onSendRef.current(trimmed);
    } finally {
      if (sendGenerationRef.current === sendGeneration) {
        sendInFlightRef.current = false;
        if (!isSpeakingRef.current) {
          setSessionState(
            assistantActiveRef.current ? "assistant_streaming" : "idle",
          );
        }
        if (!wasInterrupt) {
          const mode = preferencesRef.current.interactionMode;
          if (mode === "conversation") {
            resumeAfterAssistantTurnRef.current({ force: true });
          }
        }
      }
    }
  }, [disposeRecorderOnly, hardStopAssistantAudio, resetBargeInProbe]);

  const transcribeActiveRecording = useCallback(async (): Promise<string> => {
    const recorder = recorderRef.current;
    if (!recorder) return "";

    transcribeAbortRef.current?.abort();
    const controller = new AbortController();
    transcribeAbortRef.current = controller;

    try {
      return await recorder.stopAndTranscribe(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return "";
      const message =
        err instanceof Error ? err.message : "Transcription failed.";
      setVoiceError(message);
      return "";
    } finally {
      if (transcribeAbortRef.current === controller) {
        transcribeAbortRef.current = null;
      }
      recorder?.dispose({ keepStream: true });
      recorderRef.current = null;
      clearRecordingTimer();
    }
  }, [clearRecordingTimer]);

  const startRecording = useCallback(
    async (options: {
      silenceDetection: boolean;
      allowDuringReply?: boolean;
      onSpeechConfirmed?: () => void;
      manageSessionUi?: boolean;
      bargeInProbe?: boolean;
      silenceMs?: number;
    }): Promise<boolean> => {
      if (disabledRef.current || hasImageAttachment) return false;
      if (
        !options.allowDuringReply &&
        (assistantActiveRef.current ||
          sendInFlightRef.current ||
          processingTurnRef.current ||
          isSpeakingRef.current)
      ) {
        return false;
      }
      if (recorderRef.current?.isActive()) {
        return false;
      }

      if (wakeWordRunningRef.current) {
        stopWakeWordListener();
      }

      if (recorderRef.current) {
        recorderRef.current.dispose({ keepStream: true });
        recorderRef.current = null;
      }

      unlockAudioPlayback();
      setVoiceError(null);

      const recorder = new VoiceRecorder();
      recorderRef.current = recorder;

      const prefs = preferencesRef.current;
      const isConversationLike =
        options.silenceDetection &&
        (prefs.interactionMode === "conversation" ||
          prefs.interactionMode === "wake_word" ||
          Boolean(options.bargeInProbe));
      const useSpeechGate =
        isConversationLike || Boolean(options.onSpeechConfirmed);
      const bargeInProbe = Boolean(options.bargeInProbe);
      const silenceMs =
        options.silenceMs ??
        (bargeInProbe ? prefs.bargeInSilenceMs : prefs.silenceMs);

      const micSession = micSessionRef.current;
      const warmGate = micSession.hasWarmCalibration();

      const stream = await micSession.acquire();

      try {
        await recorder.start({
          existingStream: stream,
          level: { onLevel: setAudioLevel },
          sttProvider: prefs.sttProvider,
          openAiSttModel: prefs.openAiSttModel,
          googleSttQuality: prefs.googleSttQuality,
          speechGateOptions: useSpeechGate
            ? speechGateOptionsFromSensitivity(prefs.listeningSensitivity, {
                warm: warmGate,
                noiseFloor: micSession.getNoiseFloor(),
                bargeInProbe: options.bargeInProbe,
              })
            : undefined,
          onSpeechConfirmed: options.onSpeechConfirmed,
          allowUnconfirmedSpeech: options.bargeInProbe,
          onNoiseFloor: (floor) => {
            micSession.rememberNoiseFloor(floor);
          },
          silence:
            isConversationLike &&
            (prefs.autoSendOnEndOfTurn || bargeInProbe)
              ? {
                  silenceMs,
                  onSilence: () => {
                    void finishConversationTurnRef.current();
                  },
                }
              : undefined,
          watchdog: isConversationLike
            ? {
                onMaxDuration: () => {
                  void finishConversationTurnRef.current();
                },
                onStuckOpen: () => {
                  void finishConversationTurnRef.current();
                },
              }
            : undefined,
        });
      } catch (err) {
        recorderRef.current = null;
        micSessionRef.current.release();
        const message =
          err instanceof Error ? err.message : "Could not access microphone.";
        setVoiceError(message);
        setSessionState("idle");
        return false;
      }

      startRecordingTimer();
      if (options.manageSessionUi !== false) {
        setSessionState("listening");
        setStatusText("");
      }
      return true;
    },
    [hasImageAttachment, startRecordingTimer, stopWakeWordListener],
  );

  const resumeWakeWordIfNeeded = useCallback(() => {
    const prefs = preferencesRef.current;
    if (prefs.interactionMode !== "wake_word") return;
    if (voiceArmedRef.current) return;
    if (!isWakeWordSupported()) {
      setVoiceError(
        "Wake word requires a browser with speech recognition (Chrome, Edge, or Safari).",
      );
      return;
    }
    if (
      wakeWordRunningRef.current ||
      wakeWordStartingRef.current ||
      assistantActiveRef.current ||
      sendInFlightRef.current ||
      isSpeakingRef.current ||
      processingTurnRef.current ||
      recorderRef.current?.isActive()
    ) {
      return;
    }

    wakeWordStartingRef.current = true;
    releaseMic();

    void startWakeWord({
      sensitivity: prefs.wakeWordSensitivity,
      phrases: prefs.wakePhrases,
      onDetected: () => {
        void (async () => {
          stopWakeWordListener();
          setVoiceArmed(true);
          voiceArmedRef.current = true;
          playWakeEarcon();
          unlockAudioPlayback();
          lastSentRef.current = "";
          await new Promise((resolve) => window.setTimeout(resolve, 200));
          await startRecording({ silenceDetection: true });
        })();
      },
      onError: (message) => setVoiceError(message),
    })
      .then(() => {
        wakeWordRunningRef.current = true;
        setPassiveWakeListening(true);
        setSessionState("idle");
        setStatusText("");
      })
      .catch((err) => {
        wakeWordRunningRef.current = false;
        setPassiveWakeListening(false);
        const message =
          err instanceof Error ? err.message : "Wake word failed to start.";
        setVoiceError(message);
      })
      .finally(() => {
        wakeWordStartingRef.current = false;
      });
  }, [releaseMic, startRecording, stopWakeWordListener]);

  const returnToPassiveWake = useCallback(() => {
    setVoiceArmed(false);
    voiceArmedRef.current = false;
    releaseMic();
    window.setTimeout(() => {
      resumeWakeWordIfNeeded();
    }, 0);
  }, [releaseMic, resumeWakeWordIfNeeded]);

  const isAssistantAudioActive = useCallback(() => {
    return (
      isSpeakingRef.current ||
      streamingReplyRef.current !== null ||
      (playerRef.current?.isPlaying() ?? false) ||
      (playerRef.current?.isSuspended() ?? false)
    );
  }, []);

  const startTtsBargeIn = useCallback(() => {
    const prefs = preferencesRef.current;
    if (!prefs.bargeInEnabled || !prefs.spokenReplies) return;
    if (bargeInProbeRef.current.active) return;
    if (!isAssistantAudioActive()) return;
    if (ttsBargeInRef.current) return;

    const attach = (stream: MediaStream) => {
      if (!isAssistantAudioActive()) return;
      if (bargeInProbeRef.current.active) return;
      const listener = new TtsBargeInListener(
        ttsBargeInConfigFromSensitivity(prefs.bargeInSensitivity),
      );
      ttsBargeInRef.current = listener;
      listener.start(stream, () => {
        if (bargeInProbeRef.current.active) return;
        executeBargeInRef.current({ pushToTalk: false });
      });
    };

    const existing = micSessionRef.current.getStream();
    if (existing?.active) {
      attach(existing);
      return;
    }

    void micSessionRef.current.ensureStream().then(attach).catch(() => {});
  }, [isAssistantAudioActive]);

  useEffect(() => {
    startTtsBargeInRef.current = startTtsBargeIn;
  }, [startTtsBargeIn]);

  const beginBargeInProbe = useCallback(
    (options?: { pushToTalk?: boolean }) => {
      if (processingTurnRef.current || sessionStateRef.current === "processing_stt") {
        if (!isAssistantAudioActive()) return false;
        abortActiveCapture();
        processingTurnRef.current = false;
      }

      if (!isAssistantAudioActive()) {
        return false;
      }

      if (bargeInProbeRef.current.active) {
        return true;
      }

      stopTtsBargeIn();
      clearVoiceTimers();

      const pushToTalk = options?.pushToTalk ?? false;
      const bargeInAbortMs = preferencesRef.current.bargeInAbortMs;
      if (pushToTalk) {
        hardStopAssistantAudio();
      } else {
        void playerRef.current?.suspendPlayback();
      }

      interruptCaptureRef.current = true;
      setBargeInActive(true);
      setSessionState("listening");
      bargeInProbeRef.current = {
        active: true,
        heardSpeech: false,
        pushToTalk,
        timer: pushToTalk
          ? null
          : window.setTimeout(() => {
              if (
                bargeInProbeRef.current.active &&
                !bargeInProbeRef.current.heardSpeech
              ) {
                void abortBargeInProbeRef.current();
              }
            }, bargeInAbortMs),
        suspendedTts: !pushToTalk,
      };

      if (recorderRef.current) {
        recorderRef.current.dispose({ keepStream: true });
        recorderRef.current = null;
      }

      const useSilence = !pushToTalk;

      void startRecording({
        silenceDetection: useSilence,
        allowDuringReply: true,
        onSpeechConfirmed: () => markBargeInSpeechRef.current(),
        manageSessionUi: false,
        bargeInProbe: true,
      }).then((started) => {
        if (!started && bargeInProbeRef.current.active) {
          void abortBargeInProbeRef.current();
        }
      });

      setStatusText("");

      return true;
    },
    [abortActiveCapture, clearVoiceTimers, hardStopAssistantAudio, isAssistantAudioActive, startRecording, stopTtsBargeIn],
  );

  const bargeInWhileSpeaking = useCallback(
    (pushToTalk = false) => beginBargeInProbe({ pushToTalk }),
    [beginBargeInProbe],
  );

  useEffect(() => {
    executeBargeInRef.current = beginBargeInProbe;
  }, [beginBargeInProbe]);

  useEffect(() => {
    markBargeInSpeechRef.current = markBargeInSpeech;
  }, [markBargeInSpeech]);

  useEffect(() => {
    abortBargeInProbeRef.current = () => {
      void abortBargeInProbe();
    };
  }, [abortBargeInProbe]);

  const resumePassiveListening = useCallback(
    (options?: { allowDuringReply?: boolean }) => {
      const mode = preferencesRef.current.interactionMode;
      if (mode === "conversation") {
        void startRecording({
          silenceDetection: true,
          allowDuringReply: options?.allowDuringReply,
        });
      } else if (mode === "wake_word") {
        resumeWakeWordIfNeeded();
      }
    },
    [resumeWakeWordIfNeeded, startRecording],
  );

  /** Re-open the mic after the assistant finishes. `force` skips stale busy refs. */
  const resumeAfterAssistantTurn = useCallback(
    (options?: { force?: boolean }) => {
      if (!voiceArmedRef.current) return false;

      const mode = preferencesRef.current.interactionMode;
      if (mode !== "conversation" && mode !== "wake_word") return false;
      if (disabledRef.current || hasImageAttachment) return false;
      if (bargeInProbeRef.current.active) return false;
      if (isAssistantAudioActive()) return false;
      if (processingTurnRef.current) {
        if (options?.force && (mode === "wake_word" || mode === "conversation")) {
          window.setTimeout(() => {
            resumeAfterAssistantTurnRef.current({ force: true });
          }, 0);
        }
        return false;
      }
      if (!options?.force && sendInFlightRef.current) return false;
      if (isSpeakingRef.current) return false;
      if (!options?.force && assistantActiveRef.current) return false;
      if (recorderRef.current?.isActive()) return false;

      if (emptyResumeTimerRef.current !== null) {
        window.clearTimeout(emptyResumeTimerRef.current);
        emptyResumeTimerRef.current = null;
      }

      lastSentRef.current = "";

      setSessionState("listening");
      setStatusText("");
      void startRecording({ silenceDetection: true, allowDuringReply: true });

      return true;
    },
    [hasImageAttachment, isAssistantAudioActive, startRecording],
  );

  useEffect(() => {
    resumeAfterAssistantTurnRef.current = resumeAfterAssistantTurn;
  }, [resumeAfterAssistantTurn]);

  const endVoiceSession = useCallback((options?: { resumePassiveWake?: boolean }) => {
    const shouldCancelAssistant =
      assistantActiveRef.current ||
      sendInFlightRef.current ||
      isAssistantAudioActive();

    clearVoiceTimers();
    clearBargeInProbeTimer();
    resetBargeInProbe();
    interruptCaptureRef.current = false;
    pushToTalkActiveRef.current = false;
    abortActiveCapture();

    setVoiceArmed(false);
    voiceArmedRef.current = false;
    hardStopAssistantAudio();
    stopTtsBargeIn();
    releaseMic();
    stopWakeWordListener();

    processingTurnRef.current = false;
    sendInFlightRef.current = false;
    sendGenerationRef.current += 1;
    lastSentRef.current = "";
    setSessionState("idle");
    setStatusText("Voice paused");

    statusClearTimerRef.current = window.setTimeout(() => {
      statusClearTimerRef.current = null;
      setStatusText("");
    }, 3000);

    if (shouldCancelAssistant) {
      onBargeInRef.current();
    }

    if (
      options?.resumePassiveWake !== false &&
      preferencesRef.current.interactionMode === "wake_word"
    ) {
      window.setTimeout(() => {
        resumeWakeWordIfNeeded();
      }, 350);
    }
  }, [
    abortActiveCapture,
    clearBargeInProbeTimer,
    clearVoiceTimers,
    hardStopAssistantAudio,
    isAssistantAudioActive,
    releaseMic,
    resetBargeInProbe,
    resumeWakeWordIfNeeded,
    stopTtsBargeIn,
    stopWakeWordListener,
  ]);

  const disarmVoiceSession = useCallback(() => {
    setVoiceArmed(false);
    voiceArmedRef.current = false;
    stopSpeaking();
    releaseMic();
    stopWakeWordListener();
    setSessionState("idle");
    setStatusText("");
    if (preferencesRef.current.interactionMode === "wake_word") {
      window.setTimeout(() => {
        resumeWakeWordIfNeeded();
      }, 350);
    }
  }, [releaseMic, resumeWakeWordIfNeeded, stopSpeaking, stopWakeWordListener]);

  const deliverTranscript = useCallback(
    async (text: string): Promise<TranscriptOutcome> => {
      const trimmed = text.trim();
      if (!trimmed) return "empty";
      if (isVoiceStopPhrase(trimmed)) {
        endVoiceSession();
        return "stopped";
      }
      await sendTranscript(trimmed);
      return "sent";
    },
    [endVoiceSession, sendTranscript],
  );

  const finishConversationTurn = useCallback(async () => {
    const mode = preferencesRef.current.interactionMode;
    if (mode !== "conversation" && mode !== "wake_word") return;

    const wasInterrupt = interruptCaptureRef.current;
    const heardSpeech = bargeInProbeRef.current.heardSpeech;

    if (processingTurnRef.current) {
      return;
    }
    if (!recorderRef.current) {
      return;
    }

    processingTurnRef.current = true;
    let resumeAfterSend = false;

    if (wasInterrupt && heardSpeech) {
      hardStopAssistantAudio();
    }

    setSessionState("processing_stt");
    setStatusText("Transcribing…");

    try {
      const text = await transcribeActiveRecording();
      const outcome = await deliverTranscript(text);

      if (outcome === "stopped") return;
      if (outcome === "sent") {
        resumeAfterSend = true;
        return;
      }

      if (wasInterrupt) {
        await resumeSuspendedTts();
        return;
      }

      if (assistantActiveRef.current || isSpeakingRef.current) {
        setSessionState("assistant_streaming");
        return;
      }

      setSessionState("idle");

      const interactionMode = preferencesRef.current.interactionMode;
      if (interactionMode === "wake_word") {
        setStatusText("Didn't catch that — tap mic when ready.");
        returnToPassiveWake();
        return;
      }

      if (interactionMode === "conversation") {
        // Don't show an error-like message; just restart listening silently.
        setStatusText("");
        if (emptyResumeTimerRef.current !== null) {
          window.clearTimeout(emptyResumeTimerRef.current);
        }
        emptyResumeTimerRef.current = window.setTimeout(() => {
          emptyResumeTimerRef.current = null;
          void startRecording({ silenceDetection: true, allowDuringReply: true });
        }, EMPTY_RESUME_MS);
      }
    } finally {
      processingTurnRef.current = false;
      // Every notifyAssistantTurnComplete call above happened while we were
      // still inside this try block (processingTurnRef = true). Now that the
      // flag is clear, kick the resume ourselves — by this point sendMessage
      // has fully resolved (including endStreamingReply), so TTS is done.
      if (resumeAfterSend) {
        resumeAfterAssistantTurnRef.current({ force: true });
      }
    }
  }, [
    deliverTranscript,
    hardStopAssistantAudio,
    resumeSuspendedTts,
    returnToPassiveWake,
    resumeWakeWordIfNeeded,
    releaseMic,
    startRecording,
    transcribeActiveRecording,
  ]);

  useEffect(() => {
    finishConversationTurnRef.current = () => {
      void finishConversationTurn();
    };
  }, [finishConversationTurn]);

  const finishPushToTalk = useCallback(async () => {
    if (!pushToTalkActiveRef.current) return;

    const wasInterrupt = interruptCaptureRef.current;
    const heardSpeech = bargeInProbeRef.current.heardSpeech;
    const pushToTalk = bargeInProbeRef.current.pushToTalk;

    if (
      bargeInProbeRef.current.active &&
      !heardSpeech &&
      !pushToTalk
    ) {
      pushToTalkActiveRef.current = false;
      void abortBargeInProbeRef.current();
      return;
    }

    pushToTalkActiveRef.current = false;

    if (!recorderRef.current) {
      setSessionState("idle");
      setStatusText("");
      return;
    }

    if (wasInterrupt && heardSpeech) {
      hardStopAssistantAudio();
    }

    setSessionState("processing_stt");
    setStatusText("Transcribing…");

    const text = await transcribeActiveRecording();
    const outcome = await deliverTranscript(text);

    if (outcome === "stopped" || outcome === "sent") return;

    if (wasInterrupt) {
      await resumeSuspendedTts();
    } else {
      resumeAfterAssistantTurn({ force: true });
    }
  }, [
    deliverTranscript,
    hardStopAssistantAudio,
    resumeAfterAssistantTurn,
    resumeSuspendedTts,
    transcribeActiveRecording,
  ]);

  useEffect(() => {
    if (!assistantActive) return;
    const mode = preferencesRef.current.interactionMode;
    if (mode === "conversation" || mode === "wake_word") return;
    disposeRecorderOnly();
  }, [assistantActive, disposeRecorderOnly]);

  const getTtsVoice = useCallback((prefs: VoicePreferences) => {
    return prefs.ttsProvider === "google"
      ? prefs.googleTtsVoice
      : prefs.ttsVoice;
  }, []);

  const getPlayerOptions = useCallback(
    (prefs: VoicePreferences) => ({
      voice: getTtsVoice(prefs),
      speed: prefs.ttsSpeed,
      hd: prefs.ttsHd,
      provider: prefs.ttsProvider,
      openAiTtsModel: prefs.openAiTtsModel,
      googleTtsQuality: prefs.googleTtsQuality,
      deepgramTtsVoice: prefs.deepgramTtsVoice,
    }),
    [getTtsVoice],
  );

  const beginStreamingReply = useCallback(() => {
    const prefs = preferencesRef.current;
    if (!prefs.spokenReplies) return;

    const player = playerRef.current;
    if (!player) return;

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSessionState("assistant_speaking");
    setStatusText("");
    setVoiceError(null);

    void micSessionRef.current.ensureStream().catch(() => {});

    streamingReplyRef.current = player.playStreaming(getPlayerOptions(prefs));
    startTtsBargeIn();
  }, [getPlayerOptions, startTtsBargeIn]);

  const feedStreamingReply = useCallback((delta: string) => {
    streamingReplyRef.current?.feed(delta);
  }, []);

  const endStreamingReply = useCallback(async () => {
    const session = streamingReplyRef.current;
    if (!session) {
      stopTtsBargeIn();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    try {
      await session.finish();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Speech playback failed.";
      setVoiceError(message);
    } finally {
      if (streamingReplyRef.current === session) {
        streamingReplyRef.current = null;
      }
      stopTtsBargeIn();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }
  }, [stopTtsBargeIn]);

  const speakReply = useCallback(async (text: string) => {
    const prefs = preferencesRef.current;
    if (!prefs.spokenReplies) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const player = playerRef.current;
    if (!player) return;

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSessionState("assistant_speaking");
    setStatusText("");
    void micSessionRef.current.ensureStream().catch(() => {});
    startTtsBargeIn();

    try {
      await player.play(trimmed, getPlayerOptions(prefs));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Speech playback failed.";
      setVoiceError(message);
    } finally {
      stopTtsBargeIn();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      resumeAfterAssistantTurn({ force: true });
    }
  }, [getPlayerOptions, resumeAfterAssistantTurn, startTtsBargeIn, stopTtsBargeIn]);

  const speakInstantAck = useCallback(async () => {
    const prefs = preferencesRef.current;
    if (!prefs.spokenReplies) return;
    if (prefs.instantAckMode === "off" && !prefs.instantAck) return;

    const mode =
      prefs.instantAckMode === "spoken" || prefs.instantAck
        ? "spoken"
        : prefs.instantAckMode;

    if (mode === "off") return;

    const player = playerRef.current;
    if (!player || isSpeakingRef.current) return;

    if (mode === "earcon") {
      playThinkingEarcon();
      return;
    }

    try {
      await player.play("Got it.", {
        ...getPlayerOptions(prefs),
        speed: Math.min(prefs.ttsSpeed * 1.1, 4),
        hd: false,
      });
    } catch {
      // non-critical
    }
  }, [getPlayerOptions]);

  const displaySessionState: VoiceSessionState =
    sessionState === "listening" ||
    sessionState === "processing_stt" ||
    bargeInActive
      ? sessionState === "processing_stt"
        ? "processing_stt"
        : "listening"
      : isSpeaking
        ? "assistant_speaking"
        : assistantActive
          ? "assistant_streaming"
          : sessionState;

  const enableWakeWordPreference = useCallback(() => {
    stopWakeWordListener();
    const next = {
      ...preferencesRef.current,
      interactionMode: "wake_word" as VoiceInteractionMode,
    };
    setPreferences(next);
    saveVoicePreferences(next);
    preferencesRef.current = next;
    setVoiceArmed(false);
    voiceArmedRef.current = false;
    lastSentRef.current = "";
    releaseMic();
    resumeWakeWordIfNeeded();
  }, [releaseMic, resumeWakeWordIfNeeded, stopWakeWordListener]);

  const activatePassiveVoiceMode = useCallback(
    async (mode: "conversation" | "wake_word") => {
      if (mode === "wake_word") {
        const wasSpeaking = isSpeakingRef.current;
        const wasAssistantBusy = assistantActiveRef.current;

        if (wasSpeaking) {
          stopSpeaking();
        } else if (wasAssistantBusy) {
          onBargeInRef.current();
          stopSpeaking();
        }

        unlockAudioPlayback();
        enableWakeWordPreference();
        return;
      }

      const wasSpeaking = isSpeakingRef.current;
      const wasAssistantBusy = assistantActiveRef.current;

      if (wasSpeaking) {
        stopSpeaking();
      } else if (wasAssistantBusy) {
        onBargeInRef.current();
        stopSpeaking();
      }

      unlockAudioPlayback();
      stopWakeWordListener();
      const next = {
        ...preferencesRef.current,
        interactionMode: mode,
      };
      setPreferences(next);
      saveVoicePreferences(next);
      preferencesRef.current = next;
      setVoiceArmed(true);
      voiceArmedRef.current = true;
      lastSentRef.current = "";

      if (wasSpeaking) {
        return;
      }

      await startRecording({ silenceDetection: true, allowDuringReply: true });
    },
    [
      enableWakeWordPreference,
      startRecording,
      stopSpeaking,
      stopWakeWordListener,
    ],
  );

  const enableConversationMode = useCallback(
    () => activatePassiveVoiceMode("conversation"),
    [activatePassiveVoiceMode],
  );

  const enableWakeWordMode = useCallback(
    () => {
      enableWakeWordPreference();
    },
    [enableWakeWordPreference],
  );

  const disableVoiceMode = useCallback(() => {
    setVoiceArmed(false);
    stopSpeaking();
    clearVoiceTimers();
    releaseMic();
    stopTtsBargeIn();
    stopWakeWordListener();
    processingTurnRef.current = false;
    pushToTalkActiveRef.current = false;
    sendInFlightRef.current = false;
    lastSentRef.current = "";

    const next = {
      ...preferencesRef.current,
      interactionMode: "off" as VoiceInteractionMode,
    };
    setPreferences(next);
    saveVoicePreferences(next);
    preferencesRef.current = next;
    setSessionState("idle");
    setStatusText("");
  }, [clearVoiceTimers, releaseMic, stopSpeaking, stopTtsBargeIn, stopWakeWordListener]);

  const toggleConversationMode = useCallback(async () => {
    if (voiceArmed && preferences.interactionMode === "conversation") {
      disarmVoiceSession();
      return;
    }
    if (preferences.interactionMode === "wake_word") {
      disableVoiceMode();
    }
    setVoiceArmed(true);
    if (preferences.interactionMode === "conversation") {
      unlockAudioPlayback();
      lastSentRef.current = "";
      await startRecording({ silenceDetection: true, allowDuringReply: true });
      return;
    }
    await enableConversationMode();
  }, [
    disarmVoiceSession,
    disableVoiceMode,
    enableConversationMode,
    preferences.interactionMode,
    startRecording,
    voiceArmed,
  ]);

  const toggleWakeWordMode = useCallback(async () => {
    if (preferences.interactionMode === "wake_word") {
      if (voiceArmed) {
        endVoiceSession({ resumePassiveWake: false });
      }
      disableVoiceMode();
      return;
    }
    if (preferences.interactionMode === "conversation") {
      disarmVoiceSession();
      const next = {
        ...preferencesRef.current,
        interactionMode: "off" as VoiceInteractionMode,
      };
      setPreferences(next);
      saveVoicePreferences(next);
      preferencesRef.current = next;
    }
    enableWakeWordPreference();
  }, [
    disarmVoiceSession,
    disableVoiceMode,
    enableWakeWordPreference,
    endVoiceSession,
    preferences.interactionMode,
    voiceArmed,
  ]);

  const startPushToTalk = useCallback(() => {
    if (disabled || hasImageAttachment) return;

    if (isAssistantAudioActive()) {
      if (bargeInWhileSpeaking(true)) {
        pushToTalkActiveRef.current = true;
      }
      return;
    }

    if (conversationMode || (wakeWordPreference && voiceArmed)) {
      return;
    }

    unlockAudioPlayback();
    if (assistantActiveRef.current) {
      onBargeInRef.current();
      stopSpeaking();
      pushToTalkActiveRef.current = true;
      lastSentRef.current = "";
      void startRecording({ silenceDetection: false, allowDuringReply: true });
      return;
    }
    pushToTalkActiveRef.current = true;
    lastSentRef.current = "";
    void startRecording({ silenceDetection: false });
  }, [
    bargeInWhileSpeaking,
    conversationMode,
    disabled,
    hasImageAttachment,
    startRecording,
    stopSpeaking,
    wakeWordPreference,
    voiceArmed,
  ]);

  const endPushToTalk = useCallback(() => {
    void finishPushToTalk();
  }, [finishPushToTalk]);

  const notifyAssistantTurnComplete = useCallback(() => {
    resumeAfterAssistantTurn({ force: true });
  }, [resumeAfterAssistantTurn]);

  const interruptAssistant = useCallback(() => {
    const shouldCancelAssistant =
      assistantActiveRef.current ||
      isAssistantAudioActive() ||
      bargeInProbeRef.current.active ||
      sendInFlightRef.current;

    clearVoiceTimers();
    clearBargeInProbeTimer();
    resetBargeInProbe();
    interruptCaptureRef.current = false;
    hardStopAssistantAudio();
    pushToTalkActiveRef.current = false;
    abortActiveCapture();
    processingTurnRef.current = false;
    sendInFlightRef.current = false;
    sendGenerationRef.current += 1;
    setStatusText("");
    setVoiceArmed(false);
    voiceArmedRef.current = false;
    setSessionState("idle");

    if (shouldCancelAssistant) {
      onBargeInRef.current();
    }
  }, [
    abortActiveCapture,
    clearBargeInProbeTimer,
    clearVoiceTimers,
    hardStopAssistantAudio,
    isAssistantAudioActive,
    resetBargeInProbe,
  ]);

  const updatePreferences = useCallback((patch: Partial<VoicePreferences>) => {
    const prev = preferencesRef.current;
    const next = { ...prev, ...patch };
    setPreferences(next);
    saveVoicePreferences(next);
    preferencesRef.current = next;

    if (patch.interactionMode === "wake_word" && prev.interactionMode !== "wake_word") {
      void enableWakeWordMode();
    } else if (
      patch.interactionMode === "conversation" &&
      prev.interactionMode !== "conversation"
    ) {
      void enableConversationMode();
    } else if (patch.interactionMode === "off") {
      disableVoiceMode();
    } else if (
      (patch.wakeWordSensitivity !== undefined ||
        patch.wakePhrases !== undefined) &&
      next.interactionMode === "wake_word"
    ) {
      stopWakeWordListener();
      resumeWakeWordIfNeeded();
    }
  }, [
    disableVoiceMode,
    enableConversationMode,
    enableWakeWordMode,
    resumeWakeWordIfNeeded,
    stopWakeWordListener,
  ]);

  useEffect(() => {
    if (preferences.interactionMode !== "wake_word") return;
    if (disabled || hasImageAttachment) return;
    if (document.visibilityState !== "visible") return;
    if (voiceArmed) return;

    resumeWakeWordIfNeeded();

    const retryPassiveWake = () => {
      if (
        preferencesRef.current.interactionMode !== "wake_word" ||
        voiceArmedRef.current ||
        disabledRef.current
      ) {
        return;
      }
      resumeWakeWordIfNeeded();
    };

    document.addEventListener("pointerdown", retryPassiveWake);
    document.addEventListener("keydown", retryPassiveWake);

    return () => {
      document.removeEventListener("pointerdown", retryPassiveWake);
      document.removeEventListener("keydown", retryPassiveWake);
      stopWakeWordListener();
    };
  }, [
    disabled,
    hasImageAttachment,
    preferences.interactionMode,
    resumeWakeWordIfNeeded,
    stopWakeWordListener,
    voiceArmed,
  ]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopWakeWordListener();
        return;
      }
      const mode = preferencesRef.current.interactionMode;
      if (mode === "wake_word" && !voiceArmedRef.current) {
        resumeWakeWordIfNeeded();
      } else if (mode === "conversation" && voiceArmedRef.current) {
        resumeAfterAssistantTurnRef.current({ force: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [resumeWakeWordIfNeeded, stopWakeWordListener]);

  useEffect(() => {
    if (!voiceArmed) return;
    if (preferences.interactionMode !== "conversation") return;
    if (disabled || hasImageAttachment) return;
    if (assistantActive || isSpeaking || bargeInActive) return;
    if (sessionState !== "idle") return;
    if (processingTurnRef.current || sendInFlightRef.current) return;
    if (recorderRef.current?.isActive()) return;

    const timer = window.setTimeout(() => {
      resumeAfterAssistantTurnRef.current({ force: true });
    }, EMPTY_RESUME_MS);

    return () => window.clearTimeout(timer);
  }, [
    assistantActive,
    bargeInActive,
    disabled,
    hasImageAttachment,
    isSpeaking,
    preferences.interactionMode,
    sessionState,
    voiceArmed,
  ]);

  useEffect(() => {
    return () => {
      clearVoiceTimers();
      stopSpeaking();
      releaseMic();
      stopWakeWordListener();
    };
  }, [clearVoiceTimers, releaseMic, stopSpeaking, stopWakeWordListener]);

  return {
    preferences,
    updatePreferences,
    sessionState: displaySessionState,
    interimTranscript: statusText,
    voiceError,
    setVoiceError,
    voiceActive,
    conversationMode,
    wakeWordMode,
    passiveWakeListening,
    wakeWordPreference,
    audioLevel,
    recordingSeconds,
    settingsOpen,
    setSettingsOpen,
    toggleConversationMode,
    toggleWakeWordMode,
    disableVoiceMode,
    startPushToTalk,
    endPushToTalk,
    bargeInWhileSpeaking,
    interruptAssistant,
    notifyAssistantTurnComplete,
    bargeInActive,
    beginStreamingReply,
    feedStreamingReply,
    endStreamingReply,
    speakReply,
    speakInstantAck,
    stopSpeaking,
    isSpeaking,
  };
}
