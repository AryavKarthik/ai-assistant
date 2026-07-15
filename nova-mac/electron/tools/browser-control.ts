import { execFile } from "node:child_process";

// Browser automation via AppleScript for Chrome + Safari.
// Reading page text / running JS may require:
// - Chrome: View → Developer → "Allow JavaScript from Apple Events"
// - Safari: Develop → "Allow JavaScript from Apple Events"

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

export type BrowserName = "chrome" | "safari";

const JS_PERMISSION_HINTS: Record<BrowserName, string> = {
  chrome:
    "Chrome blocked scripting. Enable it once: Chrome menu → View → Developer → 'Allow JavaScript from Apple Events'.",
  safari:
    "Safari blocked scripting. Enable it once: Safari menu → Develop → 'Allow JavaScript from Apple Events'.",
};

function normalizeBrowser(browser?: string): BrowserName {
  return browser?.toLowerCase() === "safari" ? "safari" : "chrome";
}

function browserAppName(browser: BrowserName): "Google Chrome" | "Safari" {
  return browser === "safari" ? "Safari" : "Google Chrome";
}

function isJsPermissionError(msg: string): boolean {
  return /Executing JavaScript through AppleScript is (turned off|not allowed)|not allowed to send Apple events|JavaScript/i.test(
    msg,
  );
}

async function ensureBrowserRunning(browser: BrowserName): Promise<void> {
  await run("/usr/bin/open", ["-a", browserAppName(browser)]);
}

export interface BrowserTab {
  windowIndex: number;
  tabIndex: number;
  title: string;
  url: string;
  active: boolean;
}

type OrganizeMode = "domain" | "title";

function summarizeTab(tab: BrowserTab): string {
  return tab.title?.trim() ? `${tab.title} (${tab.url})` : tab.url;
}

function tabDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function listBrowserTabs(options?: {
  browser?: string;
}): Promise<{ browser: BrowserName; tabs: BrowserTab[] }> {
  const browser = normalizeBrowser(options?.browser);
  await ensureBrowserRunning(browser);
  const script =
    browser === "safari"
      ? `
tell application "Safari"
  set out to ""
  set winIdx to 0
  repeat with w in windows
    set winIdx to winIdx + 1
    set activeTab to current tab of w
    set tabIdx to 0
    repeat with t in tabs of w
      set tabIdx to tabIdx + 1
      set activeFlag to false
      if t is activeTab then set activeFlag to true
      set out to out & winIdx & tab & tabIdx & tab & activeFlag & tab & (name of t) & tab & (URL of t) & linefeed
    end repeat
  end repeat
  return out
end tell`
      : `
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
        active:
          browser === "safari"
            ? String(activeIdx).toLowerCase() === "true"
            : Number(tabIdx) === Number(activeIdx),
      };
    });
  return { browser, tabs };
}

export async function openBrowserTab(
  url: string,
  browserInput?: string,
  activate = true,
): Promise<{ browser: BrowserName; url: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
  const browser = normalizeBrowser(browserInput);
  await ensureBrowserRunning(browser);
  const escaped = url.replace(/"/g, '\\"');
  const script =
    browser === "safari"
      ? `
tell application "Safari"
  ${activate ? "activate" : ""}
  if (count of windows) = 0 then
    make new document
  end if
  tell window 1
    set current tab to (make new tab with properties {URL:"${escaped}"})
  end tell
end tell`
      : `
tell application "Google Chrome"
  ${activate ? "activate" : ""}
  if (count of windows) = 0 then
    make new window
  end if
  tell window 1 to make new tab with properties {URL:"${escaped}"}
end tell`;
  await osascript(script);
  return { browser, url };
}

export async function activateBrowserTab(options: {
  windowIndex?: number;
  tabIndex: number;
  browser?: string;
}): Promise<{ browser: BrowserName; activated: number }> {
  const win = options.windowIndex ?? 1;
  const browser = normalizeBrowser(options.browser);
  const script =
    browser === "safari"
      ? `
tell application "Safari"
  activate
  tell window ${win}
    set current tab to tab ${options.tabIndex}
    set index to 1
  end tell
end tell`
      : `
tell application "Google Chrome"
  activate
  set active tab index of window ${win} to ${options.tabIndex}
  set index of window ${win} to 1
end tell`;
  await osascript(script);
  return { browser, activated: options.tabIndex };
}

export async function closeBrowserTab(options: {
  windowIndex?: number;
  tabIndex: number;
  browser?: string;
}): Promise<{ browser: BrowserName; closed: number }> {
  const win = options.windowIndex ?? 1;
  const browser = normalizeBrowser(options.browser);
  const script = `
tell application "${browserAppName(browser)}"
  close tab ${options.tabIndex} of window ${win}
end tell`;
  await osascript(script);
  return { browser, closed: options.tabIndex };
}

export async function getActiveTabContent(options?: {
  browser?: string;
}): Promise<{
  browser: BrowserName;
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}> {
  const browser = normalizeBrowser(options?.browser);
  await ensureBrowserRunning(browser);
  let title = "";
  let url = "";
  try {
    const meta = await osascript(`
tell application "${browserAppName(browser)}"
  set t to active tab of front window
  return (${browser === "safari" ? "name" : "title"} of t) & linefeed & (URL of t)
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
    const script =
      browser === "safari"
        ? `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`
        : `tell application "Google Chrome" to tell active tab of front window to execute javascript "${escaped}"`;
    text = await osascript(script, 15000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read page";
    if (isJsPermissionError(msg)) throw new Error(JS_PERMISSION_HINTS[browser]);
    throw new Error(msg);
  }
  const truncated = text.length > MAX;
  return {
    browser,
    title,
    url,
    text: truncated ? text.slice(0, MAX) + "…" : text,
    truncated,
  };
}

export async function executeBrowserJs(
  code: string,
  options?: { browser?: string },
): Promise<{ browser: BrowserName; result: string; truncated: boolean }> {
  if (!code.trim()) throw new Error("code is required");
  const browser = normalizeBrowser(options?.browser);
  await ensureBrowserRunning(browser);
  // Wrap so the last expression's value is returned as a string.
  const wrapped = `(function(){ try { return String((function(){ ${code} })()); } catch(e){ return "ERROR: "+e.message; } })()`;
  const escaped = wrapped.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let out: string;
  try {
    const script =
      browser === "safari"
        ? `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`
        : `tell application "Google Chrome" to tell active tab of front window to execute javascript "${escaped}"`;
    out = await osascript(script, 20000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "JavaScript failed";
    if (isJsPermissionError(msg)) throw new Error(JS_PERMISSION_HINTS[browser]);
    throw new Error(msg);
  }
  const MAX = 6000;
  const truncated = out.length > MAX;
  return { browser, result: truncated ? out.slice(0, MAX) + "…" : out, truncated };
}

export async function organizeBrowserTabs(options?: {
  windowIndex?: number;
  mode?: OrganizeMode;
  dryRun?: boolean;
  browser?: string;
}): Promise<{
  browser: BrowserName;
  windowIndex: number;
  mode: OrganizeMode;
  changed: boolean;
  before: string[];
  after: string[];
  moved_count: number;
  dry_run: boolean;
}> {
  const browser = normalizeBrowser(options?.browser);
  await ensureBrowserRunning(browser);
  const windowIndex = options?.windowIndex ?? 1;
  const mode: OrganizeMode = options?.mode ?? "domain";
  const dryRun = options?.dryRun ?? false;

  const allTabs = (await listBrowserTabs({ browser })).tabs.filter((t) => t.windowIndex === windowIndex);
  if (allTabs.length === 0) {
    throw new Error(`No tabs found for ${browserAppName(browser)} window ${windowIndex}`);
  }

  const sortable = allTabs.map((tab, i) => ({ tab, originalOrder: i }));
  const sorted = [...sortable].sort((a, b) => {
    const aKey = mode === "title" ? a.tab.title.toLowerCase() : tabDomain(a.tab.url);
    const bKey = mode === "title" ? b.tab.title.toLowerCase() : tabDomain(b.tab.url);
    const keyCmp = aKey.localeCompare(bKey);
    if (keyCmp !== 0) return keyCmp;
    const titleCmp = a.tab.title.toLowerCase().localeCompare(b.tab.title.toLowerCase());
    if (titleCmp !== 0) return titleCmp;
    return a.originalOrder - b.originalOrder;
  });

  const before = allTabs.map(summarizeTab);
  const after = sorted.map((s) => summarizeTab(s.tab));
  const changed = sorted.some((s, i) => s.originalOrder !== i);
  const movedCount = sorted.reduce((acc, s, i) => acc + (s.originalOrder === i ? 0 : 1), 0);

  if (!dryRun && changed) {
    const refList = sorted
      .map((s) => `tab ${s.tab.tabIndex} of w`)
      .join(", ");
    const script = `
tell application "${browserAppName(browser)}"
  set w to window ${windowIndex}
  set orderedTabs to {${refList}}
  repeat with i from 1 to (count of orderedTabs)
    set index of (item i of orderedTabs) to i
  end repeat
end tell`;
    await osascript(script, 20000);
  }

  return {
    browser,
    windowIndex,
    mode,
    changed,
    before,
    after,
    moved_count: movedCount,
    dry_run: dryRun,
  };
}
