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
}): Promise<{ level?: number; muted?: boolean; verified: boolean }> {
  if (options.muted !== undefined) {
    await osascript(`set volume output muted ${options.muted}`);
  }
  if (options.level !== undefined) {
    const level = Math.round(Math.max(0, Math.min(100, options.level)));
    await osascript(`set volume output volume ${level}`);
    // Read back and confirm the OS actually applied it — "success" from
    // osascript alone has let the assistant claim changes that never landed.
    const after = await getSystemVolume();
    if (Math.abs(after.level - level) > 2) {
      throw new Error(
        `Volume did not change: asked for ${level} but the system reports ${after.level}. ` +
          "The output device may not support software volume control.",
      );
    }
    return { level: after.level, muted: after.muted, verified: true };
  }
  const after = await getSystemVolume();
  return { muted: after.muted, verified: true };
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

/** Rewrites the opaque System Events keystroke-permission failure into an
 *  actionable message so the assistant can tell the user how to fix it
 *  instead of pretending the change happened. */
function explainBrightnessError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not allowed to send keystrokes|1002/.test(msg)) {
    return new Error(
      "Brightness change FAILED: macOS blocked the simulated brightness keys. " +
        "Fix: either grant Nova the Accessibility permission (System Settings → " +
        "Privacy & Security → Accessibility) or install the brightness CLI " +
        "(`brew install brightness`), then try again.",
    );
  }
  return new Error(`Brightness change FAILED: ${msg}`);
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
  try {
    await osascript(script);
  } catch (err) {
    throw explainBrightnessError(err);
  }
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
  try {
    await osascript(script);
  } catch (err) {
    throw explainBrightnessError(err);
  }
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

// ─── General automation (AppleScript / Shortcuts) ────────────────────────────

/** Rewrites common macOS automation permission errors into actionable text so
 *  the model reports what the user must grant instead of a raw error code. */
function explainAutomationError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not allowed to send keystrokes|not allowed assistive access|1002|-25211/.test(msg)) {
    return new Error(
      "AppleScript FAILED: macOS blocked UI scripting. Fix: grant Nova the " +
        "Accessibility permission in System Settings → Privacy & Security → " +
        "Accessibility, then retry.",
    );
  }
  if (/Not authorized to send Apple events|-1743/.test(msg)) {
    return new Error(
      "AppleScript FAILED: macOS blocked Automation for the target app. Fix: " +
        "System Settings → Privacy & Security → Automation → allow Nova to " +
        "control that app, then retry.",
    );
  }
  return new Error(`AppleScript FAILED: ${msg}`);
}

/** Runs an arbitrary AppleScript (execFile, no shell — the script is passed as
 *  a single -e argument so there is no quoting/injection surface). */
export async function runAppleScript(
  script: string,
  timeoutMs = 20_000,
): Promise<{ output: string }> {
  if (!script.trim()) throw new Error("script is required");
  try {
    const output = await run("/usr/bin/osascript", ["-e", script], timeoutMs);
    return { output };
  } catch (err) {
    throw explainAutomationError(err);
  }
}

/** Runs a macOS Shortcut by name via the `shortcuts` CLI, optionally passing
 *  text input. */
export async function runShortcut(
  name: string,
  input?: string,
): Promise<{ output: string }> {
  if (!name.trim()) throw new Error("name is required");
  const args = ["run", name.trim()];
  if (input !== undefined && input !== "") {
    // `shortcuts run` reads provided input from stdin with `-i -`; simpler and
    // just as effective is a temp-free echo via osascript — but the CLI also
    // accepts input on stdin only from a file path, so pass via stdin pipe.
    return new Promise((resolve, reject) => {
      const child = execFile(
        "/usr/bin/shortcuts",
        [...args, "-i", "-"],
        { timeout: 30_000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr.trim() || err.message));
          else resolve({ output: stdout.trim() });
        },
      );
      child.stdin?.write(input);
      child.stdin?.end();
    });
  }
  const output = await run("/usr/bin/shortcuts", args, 30_000);
  return { output };
}

/** Lists the user's installed Shortcuts (names, one per line). */
export async function listShortcuts(): Promise<{ shortcuts: string[] }> {
  const out = await run("/usr/bin/shortcuts", ["list"], 10_000);
  return { shortcuts: out.split("\n").map((s) => s.trim()).filter(Boolean) };
}
