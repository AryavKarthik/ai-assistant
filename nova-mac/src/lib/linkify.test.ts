import { describe, expect, it } from "vitest";
import { splitLinks } from "./linkify";

describe("splitLinks", () => {
  it("passes through text without URLs", () => {
    expect(splitLinks("no links here")).toEqual([{ type: "text", value: "no links here" }]);
  });

  it("extracts a YouTube URL mid-sentence", () => {
    expect(splitLinks("here: https://www.youtube.com/watch?v=4NRXx6U8ABQ enjoy")).toEqual([
      { type: "text", value: "here: " },
      { type: "link", value: "https://www.youtube.com/watch?v=4NRXx6U8ABQ" },
      { type: "text", value: " enjoy" },
    ]);
  });

  it("keeps trailing sentence punctuation out of the URL", () => {
    const segs = splitLinks("watch https://youtu.be/abc123XYZ_-.");
    expect(segs[1]).toEqual({ type: "link", value: "https://youtu.be/abc123XYZ_-" });
    expect(segs[2]).toEqual({ type: "text", value: "." });
  });

  it("handles multiple URLs", () => {
    const segs = splitLinks("https://a.com and https://b.com");
    expect(segs.filter((s) => s.type === "link").map((s) => s.value)).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});
