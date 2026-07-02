import { execFile } from "node:child_process";

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

const osascript = (script: string) => run("/usr/bin/osascript", ["-e", script]);

// ─── Volume ───────────────────────────────────────────────────────────────────

export async function setSystemVolume(options: {
  level?: number; // 0–100
  muted?: boolean;
}): Promise<{ level?: number; muted?: boolean }> {
  if (options.muted !== undefined) {
    await osascript(`set volume output muted ${options.muted}`);
  }
  if (options.level !== undefined) {
    const level = Math.round(Math.max(0, Math.min(100, options.level)));
    await osascript(`set volume output volume ${level}`);
    return { level, muted: options.muted };
  }
  return { muted: options.muted };
}

export async function getSystemVolume(): Promise<{ level: number; muted: boolean }> {
  const out = await osascript(
    'get volume settings',
  );
  // e.g. "output volume:44, input volume:71, alert volume:100, output muted:false"
  const level = Number(/output volume:(\d+)/.exec(out)?.[1] ?? "0");
  const muted = /output muted:true/.test(out);
  return { level, muted };
}

// ─── Brightness ───────────────────────────────────────────────────────────────

// macOS has no scriptable absolute brightness API. Strategy: use the `brightness`
// CLI (brew install brightness) when present; otherwise fall back to simulating
// the F1/F2 brightness keys via System Events (16 hardware steps, needs the
// Accessibility permission macOS prompts for on first use).
const BRIGHTNESS_STEPS = 16;

async function brightnessCliPath(): Promise<string | null> {
  for (const p of ["/opt/homebrew/bin/brightness", "/usr/local/bin/brightness"]) {
    try {
      await run("/bin/test", ["-x", p]);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

export async function setScreenBrightness(level: number): Promise<{ level: number; method: string }> {
  const clamped = Math.max(0, Math.min(1, level));
  const cli = await brightnessCliPath();
  if (cli) {
    await run(cli, [clamped.toFixed(2)]);
    return { level: clamped, method: "brightness-cli" };
  }
  // Fallback: drive to zero, then step up to the target.
  const upPresses = Math.round(clamped * BRIGHTNESS_STEPS);
  const script = [
    "tell application \"System Events\"",
    ...Array.from({ length: BRIGHTNESS_STEPS }, () => "key code 145"),
    ...Array.from({ length: upPresses }, () => "key code 144"),
    "end tell",
  ].join("\n");
  await osascript(script);
  return { level: clamped, method: "key-simulation" };
}

export async function nudgeScreenBrightness(direction: "up" | "down", steps = 2): Promise<{ method: string }> {
  const cli = await brightnessCliPath();
  const n = Math.max(1, Math.min(BRIGHTNESS_STEPS, Math.round(steps)));
  if (cli) {
    const out = await run(cli, ["-l"]);
    const current = Number(/brightness (\d*\.?\d+)/.exec(out)?.[1] ?? "0.5");
    const next = Math.max(0, Math.min(1, current + (direction === "up" ? 1 : -1) * (n / BRIGHTNESS_STEPS)));
    await run(cli, [next.toFixed(2)]);
    return { method: "brightness-cli" };
  }
  const keyCode = direction === "up" ? 144 : 145;
  const script = [
    "tell application \"System Events\"",
    ...Array.from({ length: n }, () => `key code ${keyCode}`),
    "end tell",
  ].join("\n");
  await osascript(script);
  return { method: "key-simulation" };
}

// ─── Apps & URLs ──────────────────────────────────────────────────────────────

export async function openApp(name: string): Promise<void> {
  // `open -a` resolves app names case-insensitively and errors on unknown apps.
  await run("/usr/bin/open", ["-a", name]);
}

export async function quitApp(name: string): Promise<void> {
  const escaped = name.replace(/"/g, '\\"');
  await osascript(`tell application "${escaped}" to quit`);
}

export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
  // Lazy import keeps this module loadable outside Electron (vitest runs in Node).
  const { shell } = await import("electron");
  await shell.openExternal(url);
}
