import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "electron", "wakeword", "models");
mkdirSync(dir, { recursive: true });

const BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";
const files = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"];

for (const f of files) {
  const dest = join(dir, f);
  if (existsSync(dest)) { console.log("exists", f); continue; }
  console.log("downloading", f, "...");
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok || !res.body) throw new Error(`download failed for ${f}: ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log("downloaded", f);
}
