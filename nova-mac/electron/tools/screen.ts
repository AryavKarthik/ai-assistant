import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve();
    });
  });
}

/** macOS Screen Recording permission state for this app. */
export async function screenRecordingStatus(): Promise<
  "granted" | "denied" | "not-determined" | "restricted" | "unknown"
> {
  try {
    const { systemPreferences } = await import("electron");
    return systemPreferences.getMediaAccessStatus("screen") as
      | "granted"
      | "denied"
      | "not-determined"
      | "restricted";
  } catch {
    return "unknown";
  }
}

async function openScreenRecordingSettings(): Promise<void> {
  try {
    const { shell } = await import("electron");
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  } catch {
    // best effort
  }
}

export interface Screenshot {
  mediaType: "image/jpeg";
  base64: string;
}

/**
 * Captures the screen as a downsized JPEG for vision. Screen Recording
 * permission is required — without it macOS returns a desktop-only image, so
 * we check first and guide the user to the setting instead of silently
 * handing Claude a blank picture.
 *
 * `display` is 1-based (1 = main). Resized so the long edge is ≤1568px, which
 * keeps it in Claude's efficient vision range (~1 image ≈ 1–1.6K tokens).
 */
export async function captureScreen(display = 1): Promise<Screenshot> {
  const status = await screenRecordingStatus();
  if (status === "denied" || status === "restricted") {
    await openScreenRecordingSettings();
    throw new Error(
      "Screen Recording permission is off, so I can't see the screen. Turn Nova on in " +
        "System Settings → Privacy & Security → Screen Recording (it shows as 'Electron' in dev), " +
        "then fully quit and reopen Nova. I've opened that pane for you.",
    );
  }

  const path = join(tmpdir(), `nova-screen-${Date.now()}.jpg`);
  try {
    // -x: silent, -t jpg, -D <n>: display. First run triggers the macOS
    // permission prompt if it's still 'not-determined'.
    await run("/usr/sbin/screencapture", ["-x", "-t", "jpg", "-D", String(display), path]);
    // Downscale the long edge so we don't ship a 6MP image to the model.
    await run("/usr/bin/sips", ["-Z", "1568", path], 10_000).catch(() => {});
    const buf = await readFile(path);
    if (buf.length < 1024) {
      throw new Error("Screenshot came back empty — check Screen Recording permission for Nova.");
    }
    return { mediaType: "image/jpeg", base64: buf.toString("base64") };
  } finally {
    await unlink(path).catch(() => {});
  }
}
