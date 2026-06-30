import { describe, it, expect } from "vitest";
import { IpcChannel, DEFAULT_VOICE_PREFERENCES } from "./types";

describe("IpcChannel", () => {
  it("defines the foundation channels", () => {
    expect(IpcChannel.Ping).toBe("ping");
    expect(IpcChannel.AuthStatus).toBe("auth:status");
    expect(IpcChannel.AuthSignIn).toBe("auth:signIn");
    expect(IpcChannel.SyncConversations).toBe("sync:conversations");
  });
});

describe("IpcChannel — Plan 2 voice/wake/chat channels", () => {
  it("defines the new channels", () => {
    expect(IpcChannel.WakeAudioFrame).toBe("wake:audioFrame");
    expect(IpcChannel.WakeDetected).toBe("wake:detected");
    expect(IpcChannel.WakeSetEnabled).toBe("wake:setEnabled");
    expect(IpcChannel.VoiceTranscribe).toBe("voice:transcribe");
    expect(IpcChannel.VoiceSynthesize).toBe("voice:synthesize");
    expect(IpcChannel.VoiceGetPreferences).toBe("voice:getPreferences");
    expect(IpcChannel.VoiceTurnEnded).toBe("voice:turnEnded");
    expect(IpcChannel.ChatSend).toBe("chat:send");
    expect(IpcChannel.ChatDelta).toBe("chat:delta");
    expect(IpcChannel.ChatDone).toBe("chat:done");
    expect(IpcChannel.ChatError).toBe("chat:error");
    expect(IpcChannel.ChatCancel).toBe("chat:cancel");
  });
});

describe("DEFAULT_VOICE_PREFERENCES", () => {
  it("defaults to wake-word mode with openai providers", () => {
    expect(DEFAULT_VOICE_PREFERENCES.interactionMode).toBe("wake_word");
    expect(DEFAULT_VOICE_PREFERENCES.sttProvider).toBe("openai");
    expect(DEFAULT_VOICE_PREFERENCES.ttsProvider).toBe("openai");
    expect(DEFAULT_VOICE_PREFERENCES.silenceMs).toBe(1500);
    expect(DEFAULT_VOICE_PREFERENCES.bargeInEnabled).toBe(true);
  });
});
