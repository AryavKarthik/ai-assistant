import { exec, execFile } from "node:child_process";

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
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

// ─── Arbitrary automation (full-power) ─────────────────────────────────────────
// These give Claude an open-ended escape hatch to drive anything on the Mac.
// They are intentionally unrestricted per the user's "full power" choice — the
// only guardrails are execution timeouts and output caps so a runaway command
// can't hang or flood the turn.

const MAX_OUTPUT_CHARS = 6000;

function clampOutput(s: string): { output: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT_CHARS) return { output: s, truncated: false };
  return { output: s.slice(0, MAX_OUTPUT_CHARS) + "…", truncated: true };
}

export async function runAppleScript(
  script: string,
  timeoutMs = 20000,
): Promise<{ output: string; truncated: boolean }> {
  if (!script.trim()) throw new Error("script is required");
  const raw = await run("/usr/bin/osascript", ["-e", script], timeoutMs);
  return clampOutput(raw);
}

export async function runShellCommand(
  command: string,
  timeoutMs = 30000,
): Promise<{ output: string; exitCode: number; truncated: boolean }> {
  if (!command.trim()) throw new Error("command is required");
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, shell: "/bin/zsh" },
      (err, stdout, stderr) => {
        const merged = [stdout, stderr].filter(Boolean).join("\n").trim();
        const { output, truncated } = clampOutput(merged);
        const exitCode =
          err && typeof (err as { code?: number }).code === "number"
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ output, exitCode, truncated });
      },
    );
  });
}

// ─── Spotlight file search ─────────────────────────────────────────────────────

// mdfind kind hints → Spotlight content-type queries. Keeps the tool schema small
// while letting Claude scope a search ("find my invoice PDFs").
const KIND_QUERIES: Record<string, string> = {
  pdf: "kMDItemContentType == 'com.adobe.pdf'",
  image: "kMDItemContentTypeTree == 'public.image'",
  video: "kMDItemContentTypeTree == 'public.movie'",
  audio: "kMDItemContentTypeTree == 'public.audio'",
  document: "kMDItemContentTypeTree == 'public.content'",
  folder: "kMDItemContentType == 'public.folder'",
  app: "kMDItemContentType == 'com.apple.application-bundle'",
};

export async function spotlightSearch(options: {
  query: string;
  kind?: string;
  limit?: number;
}): Promise<{ paths: string[]; count: number }> {
  const { query, kind, limit = 20 } = options;
  if (!query.trim()) throw new Error("query is required");
  const args: string[] = [];
  const kindClause = kind ? KIND_QUERIES[kind.toLowerCase()] : undefined;
  if (kindClause) {
    // Combine a free-text match with the kind predicate.
    args.push("-interpret", query, kindClause);
    // mdfind can't AND -interpret with a raw predicate directly, so fall back to
    // a compound predicate query instead.
    args.length = 0;
    args.push(
      `(kMDItemDisplayName == "*${query}*"cd || kMDItemTextContent == "*${query}*"cd) && ${kindClause}`,
    );
  } else {
    args.push("-name", query);
  }
  let raw: string;
  try {
    raw = await run("/usr/bin/mdfind", args, 12000);
  } catch (err) {
    // A malformed compound query still shouldn't crash the turn.
    throw new Error(err instanceof Error ? err.message : "Spotlight search failed");
  }
  const paths = raw
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(limit, 100)));
  return { paths, count: paths.length };
}

export async function openPath(path: string): Promise<void> {
  if (!path.trim()) throw new Error("path is required");
  // `open` handles files, folders, and .app bundles alike.
  await run("/usr/bin/open", [path]);
}

// ─── System Settings panes ──────────────────────────────────────────────────────

// Deep links into System Settings (macOS 13+) / System Preferences panes.
const SETTINGS_PANES: Record<string, string> = {
  wifi: "x-apple.systempreferences:com.apple.wifi-settings-extension",
  bluetooth: "x-apple.systempreferences:com.apple.BluetoothSettings",
  network: "x-apple.systempreferences:com.apple.Network-Settings.extension",
  displays: "x-apple.systempreferences:com.apple.Displays-Settings.extension",
  sound: "x-apple.systempreferences:com.apple.Sound-Settings.extension",
  notifications: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
  battery: "x-apple.systempreferences:com.apple.Battery-Settings.extension",
  keyboard: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
  trackpad: "x-apple.systempreferences:com.apple.Trackpad-Settings.extension",
  privacy: "x-apple.systempreferences:com.apple.preference.security",
  accessibility: "x-apple.systempreferences:com.apple.preference.universalaccess",
  general: "x-apple.systempreferences:com.apple.systempreferences.GeneralSettings",
  appearance: "x-apple.systempreferences:com.apple.Appearance-Settings.extension",
  storage: "x-apple.systempreferences:com.apple.settings.Storage",
  users: "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension",
  software_update: "x-apple.systempreferences:com.apple.Software-Update-Settings.extension",
  focus: "x-apple.systempreferences:com.apple.Focus-Settings.extension",
  screentime: "x-apple.systempreferences:com.apple.Screen-Time-Settings.extension",
  wallpaper: "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension",
};

export function settingsPaneList(): string[] {
  return Object.keys(SETTINGS_PANES);
}

export async function openSettingsPane(pane: string): Promise<{ opened: string }> {
  const key = pane.toLowerCase().replace(/[\s-]+/g, "_");
  const url = SETTINGS_PANES[key];
  if (!url) {
    // Fall back to just opening System Settings at its root.
    await run("/usr/bin/open", ["-a", "System Settings"]);
    return { opened: "System Settings (root)" };
  }
  await run("/usr/bin/open", [url]);
  return { opened: key };
}

// ─── Clipboard ──────────────────────────────────────────────────────────────────

export async function getClipboard(): Promise<{ text: string; truncated: boolean }> {
  const raw = await run("/usr/bin/pbpaste", []);
  const { output, truncated } = clampOutput(raw);
  return { text: output, truncated };
}

export async function setClipboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = exec("/usr/bin/pbcopy", (err) => (err ? reject(err) : resolve()));
    child.stdin?.end(text);
  });
}

// ─── Screenshot ──────────────────────────────────────────────────────────────────

export async function takeScreenshot(options?: {
  interactive?: boolean;
}): Promise<{ path: string }> {
  const dir = process.env.TMPDIR || "/tmp";
  const path = `${dir.replace(/\/$/, "")}/nova-screenshot-${Date.now()}.png`;
  // -x silences the capture sound; -i lets the user select a region/window.
  const args = options?.interactive ? ["-i", path] : ["-x", path];
  await run("/usr/sbin/screencapture", args, 60000);
  return { path };
}

// ─── Media playback keys ─────────────────────────────────────────────────────────

// System-wide media keys via System Events key codes. Works for Music, Spotify,
// browser video, etc. — whatever currently owns "Now Playing".
const MEDIA_KEY_CODES: Record<string, number> = {
  playpause: 16, // NX_KEYTYPE_PLAY
  next: 17,
  previous: 18,
};

export async function mediaControl(
  action: "playpause" | "next" | "previous",
): Promise<{ action: string }> {
  // AppleScript can't send NX system-defined media keys directly, so shell out
  // to a tiny Python helper that posts them via Quartz. Fall back to controlling
  // Music/Spotify by name if Quartz is unavailable.
  const code = MEDIA_KEY_CODES[action];
  const py = [
    "import Quartz",
    `key=${code}`,
    "def post(down):",
    "    e=Quartz.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(14,(0,0),0xa00 if down else 0xb00,0,0,None,8,(key<<16)|((0xa if down else 0xb)<<8),-1)",
    "    Quartz.CGEventPost(0, e.CGEvent())",
    "post(True); post(False)",
  ].join("\n");
  try {
    await run("/usr/bin/python3", ["-c", py], 5000);
    return { action };
  } catch {
    // Fallback: whichever of Music/Spotify is running gets the command.
    const appAction =
      action === "playpause" ? "playpause" : action === "next" ? "next track" : "previous track";
    const script = [
      'if application "Spotify" is running then',
      `  tell application "Spotify" to ${appAction}`,
      'else if application "Music" is running then',
      `  tell application "Music" to ${appAction}`,
      "end if",
    ].join("\n");
    await osascript(script);
    return { action };
  }
}
