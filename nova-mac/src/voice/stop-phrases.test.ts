import { describe, expect, it } from "vitest";
import { isVoiceStopPhrase } from "./stop-phrases";

describe("isVoiceStopPhrase", () => {
  it("matches exact dismissal phrases", () => {
    expect(isVoiceStopPhrase("stop")).toBe(true);
    expect(isVoiceStopPhrase("that's all")).toBe(true);
    expect(isVoiceStopPhrase("thank you very much")).toBe(true);
    expect(isVoiceStopPhrase("never mind")).toBe(true);
  });

  it("matches strong dismissals anywhere in a longer sentence", () => {
    expect(isVoiceStopPhrase("Thanks Jarvis, that will be all")).toBe(true);
    expect(isVoiceStopPhrase("okay that'll be all for today, thank you")).toBe(true);
    expect(isVoiceStopPhrase("thatll be all for now mate")).toBe(true);
    expect(isVoiceStopPhrase("alright goodbye Jarvis, have a good night")).toBe(true);
    expect(isVoiceStopPhrase("you can stop listening now")).toBe(true);
    expect(isVoiceStopPhrase("cool, go to sleep now")).toBe(true);
  });

  it("matches end-anchored dismissals with trailing filler", () => {
    expect(isVoiceStopPhrase("okay great, that's enough")).toBe(true);
    expect(isVoiceStopPhrase("perfect, I'm done thanks")).toBe(true);
    expect(isVoiceStopPhrase("nice one, that's it for now")).toBe(true);
  });

  it("does not end the conversation on commands that merely contain stop-like words", () => {
    expect(isVoiceStopPhrase("stop the timer")).toBe(false);
    expect(isVoiceStopPhrase("can you stop the music")).toBe(false);
    expect(isVoiceStopPhrase("don't stop the playlist")).toBe(false);
    expect(isVoiceStopPhrase("cancel my 3pm meeting")).toBe(false);
    expect(isVoiceStopPhrase("set a timer for 10 minutes")).toBe(false);
    expect(isVoiceStopPhrase("what's the weather like today")).toBe(false);
  });

  it("does not fire on mid-sentence occurrences of the weaker phrases", () => {
    expect(isVoiceStopPhrase("is that's it playing on netflix tonight or not")).toBe(false);
    expect(isVoiceStopPhrase("i'm done with the report so email it to sam")).toBe(false);
  });
});
