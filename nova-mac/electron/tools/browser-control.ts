import { execFile } from "node:child_process";

// Chrome browser automation via AppleScript. All operations target Google Chrome
// (the most scriptable Mac browser). Reading page text / running JS additionally
// requires Chrome → View → Developer → "Allow JavaScript from Apple Events" to be
// enabled once; we surface a clear hint when it isn't.

function run(cmd: string, args: string[], timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

const osascript = (script: string, timeoutMs = 12000) =>
  run("/usr/bin/osascript", ["-e", script], timeoutMs);

const JS_PERMISSION_HINT =
  "Chrome blocked scripting. Enable it once: Chrome menu → View → Developer → 'Allow JavaScript from Apple Events'.";

function isJsPermissionError(msg: string): boolean {
  return /Executing JavaScript through AppleScript is (turned off|not allowed)|not allowed to send Apple events|JavaScript/i.test(
    msg,
  );
}

async function ensureChromeRunning(): Promise<void> {
  // Launch Chrome if closed so tab operations don't fail on a dead app.
  await run("/usr/bin/open", ["-a", "Google Chrome"]);
}

export interface BrowserTab {
  windowIndex: number;
  tabIndex: number;
  title: string;
  url: string;
  active: boolean;
}

export async function listBrowserTabs(): Promise<{ tabs: BrowserTab[] }> {
  await ensureChromeRunning();
  // Emit one line per tab: winIdx\ttabIdx\tactiveTabIdx\ttitle\turl
  const script = `
tell application "Google Chrome"
  set out to ""
  set winIdx to 0
  repeat with w in windows
    set winIdx to winIdx + 1
    set activeIdx to active tab index of w
    set tabIdx to 0
    repeat with t in tabs of w
      set tabIdx to tabIdx + 1
      set out to out & winIdx & tab & tabIdx & tab & activeIdx & tab & (title of t) & tab & (URL of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;
  const raw = await osascript(script);
  const tabs: BrowserTab[] = raw
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 5)
    .map((cols) => {
      const [winIdx, tabIdx, activeIdx, title, ...urlParts] = cols;
      return {
        windowIndex: Number(winIdx),
        tabIndex: Number(tabIdx),
        title: title ?? "",
        url: urlParts.join("\t"),
        active: Number(tabIdx) === Number(activeIdx),
      };
    });
  return { tabs };
}

export async function openBrowserTab(
  url: string,
  activate = true,
): Promise<{ url: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
  await ensureChromeRunning();
  const escaped = url.replace(/"/g, '\\"');
  const script = `
tell application "Google Chrome"
  ${activate ? "activate" : ""}
  if (count of windows) = 0 then
    make new window
  end if
  tell window 1 to make new tab with properties {URL:"${escaped}"}
end tell`;
  await osascript(script);
  return { url };
}

export async function activateBrowserTab(options: {
  windowIndex?: number;
  tabIndex: number;
}): Promise<{ activated: number }> {
  const win = options.windowIndex ?? 1;
  const script = `
tell application "Google Chrome"
  activate
  set active tab index of window ${win} to ${options.tabIndex}
  set index of window ${win} to 1
end tell`;
  await osascript(script);
  return { activated: options.tabIndex };
}

export async function closeBrowserTab(options: {
  windowIndex?: number;
  tabIndex: number;
}): Promise<{ closed: number }> {
  const win = options.windowIndex ?? 1;
  const script = `
tell application "Google Chrome"
  close tab ${options.tabIndex} of window ${win}
end tell`;
  await osascript(script);
  return { closed: options.tabIndex };
}

export async function getActiveTabContent(): Promise<{
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}> {
  await ensureChromeRunning();
  let title = "";
  let url = "";
  try {
    const meta = await osascript(`
tell application "Google Chrome"
  set t to active tab of front window
  return (title of t) & linefeed & (URL of t)
end tell`);
    const [tt, ...uu] = meta.split("\n");
    title = tt ?? "";
    url = uu.join("\n");
  } catch {
    // Non-fatal; continue to try reading text.
  }

  const MAX = 8000;
  const js = "document.body.innerText";
  const escaped = js.replace(/"/g, '\\"');
  let text = "";
  try {
    text = await osascript(
      `tell application "Google Chrome" to tell active tab of front window to execute javascript "${escaped}"`,
      15000,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read page";
    if (isJsPermissionError(msg)) throw new Error(JS_PERMISSION_HINT);
    throw new Error(msg);
  }
  const truncated = text.length > MAX;
  return {
    title,
    url,
    text: truncated ? text.slice(0, MAX) + "…" : text,
    truncated,
  };
}

export async function executeBrowserJs(
  code: string,
): Promise<{ result: string; truncated: boolean }> {
  if (!code.trim()) throw new Error("code is required");
  await ensureChromeRunning();
  // Wrap so the last expression's value is returned as a string.
  const wrapped = `(function(){ try { return String((function(){ ${code} })()); } catch(e){ return "ERROR: "+e.message; } })()`;
  const escaped = wrapped.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let out: string;
  try {
    out = await osascript(
      `tell application "Google Chrome" to tell active tab of front window to execute javascript "${escaped}"`,
      20000,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "JavaScript failed";
    if (isJsPermissionError(msg)) throw new Error(JS_PERMISSION_HINT);
    throw new Error(msg);
  }
  const MAX = 6000;
  const truncated = out.length > MAX;
  return { result: truncated ? out.slice(0, MAX) + "…" : out, truncated };
}
