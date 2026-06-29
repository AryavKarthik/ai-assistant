# Phase 4E — Plan 1: Foundation & Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a signed, notarized macOS Electron app shell with a transparent always-on-top orb window, a tray icon, typed IPC, Supabase magic-link auth with Keychain-persisted sessions, and a live read of the user's existing conversations/memories — proving the riskiest infra (native-addon notarization, Keychain auth, Supabase sync) before any feature work.

**Architecture:** A new standalone Electron app at `nova-mac/`, built with Vite + electron-builder. The **main process** owns all privileged access and Supabase/Anthropic calls; the **renderer** is a pure React view layer reached only through a typed `contextBridge` preload. This plan delivers the shell + auth + read-sync; features land in Plans 2–4. It does NOT import the Next.js app — framework-agnostic logic is copied into `shared/`.

**Tech Stack:** Electron 33+, Vite, TypeScript (strict), React 19, Vitest, `@supabase/supabase-js` ^2.108, electron-builder (code signing + notarization), `keytar`-free Keychain via Electron `safeStorage`.

## Global Constraints

- **macOS only.** Apple Silicon is the primary target; Intel is best-effort.
- **Node floor:** Node 20+ for tooling (dev machine runs v24). Electron 33+ (Chromium ≥ v28 requirement for native deps in later plans).
- **Renderer is sandboxed:** every `BrowserWindow` uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The preload `contextBridge` is the ONLY renderer↔main surface. No `require`/`fs`/`child_process` in renderer code.
- **No Next.js runtime in Electron.** Reused logic is copied into `nova-mac/shared/`, never imported from `../`.
- **Env var names match the web app:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key only in the Mac client — never the service role key).
- **TypeScript strict mode** on; `npm run build` (tsc) must pass with zero errors.
- **Default model when chat lands (Plan 2+):** `claude-haiku-4-5`. Not used in this plan but fixed here.
- **Test runner:** Vitest. Pure-logic modules get real unit tests; Electron integration is verified by launching the app and observing documented output.
- **Frequent commits:** one commit per completed task minimum.

---

## File Structure

**New files (this plan):**
- `nova-mac/package.json` — app manifest, scripts, deps
- `nova-mac/tsconfig.json` — strict TS config
- `nova-mac/vitest.config.ts` — test config
- `nova-mac/electron.vite.config.ts` — Vite build for main/preload/renderer
- `nova-mac/electron/main.ts` — app lifecycle, window, tray
- `nova-mac/electron/window.ts` — orb window factory (transparent, always-on-top)
- `nova-mac/electron/tray.ts` — tray icon + menu
- `nova-mac/electron/preload.ts` — contextBridge IPC surface
- `nova-mac/electron/ipc.ts` — typed IPC channel registry + handler registration
- `nova-mac/electron/auth.ts` — magic-link flow + deep-link callback handling
- `nova-mac/electron/session-store.ts` — Keychain persistence via safeStorage
- `nova-mac/electron/supabase.ts` — main-process Supabase client factory
- `nova-mac/electron/sync.ts` — read conversations/memories
- `nova-mac/electron/native-probe/index.ts` + `binding.gyp` — minimal native addon (notarization proof)
- `nova-mac/shared/types.ts` — shared IPC + domain types
- `nova-mac/src/main.tsx` — React entry
- `nova-mac/src/App.tsx` — root component (auth gate → sync view)
- `nova-mac/src/lib/ipc.ts` — renderer-side typed IPC wrappers
- `nova-mac/index.html` — renderer HTML
- `nova-mac/electron-builder.json` — packaging + signing + notarization
- `nova-mac/.env.example` — required env vars
- `nova-mac/README.md` — setup, build, signing instructions
- Test files: `nova-mac/shared/types.test.ts`, `nova-mac/electron/session-store.test.ts`, `nova-mac/electron/sync.test.ts`, `nova-mac/electron/ipc.test.ts`

---

### Task 1: Scaffold the Electron + Vite + TypeScript + Vitest project

**Files:**
- Create: `nova-mac/package.json`, `nova-mac/tsconfig.json`, `nova-mac/vitest.config.ts`, `nova-mac/electron.vite.config.ts`, `nova-mac/index.html`, `nova-mac/src/main.tsx`, `nova-mac/src/App.tsx`, `nova-mac/.gitignore`
- Test: `nova-mac/shared/types.test.ts`, `nova-mac/shared/types.ts`

**Interfaces:**
- Produces: a buildable project; `shared/types.ts` exporting `IpcChannel` enum and core domain types consumed by every later task.

- [ ] **Step 1: Create `nova-mac/package.json`**

```json
{
  "name": "nova-mac",
  "version": "0.1.0",
  "description": "Nova — native macOS helper",
  "main": "out/main/main.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "tsc --noEmit && electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "npm run build && electron-builder --mac"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.3.0",
    "electron-builder": "^25.1.8",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "typescript": "^5.6.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4.3.0"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.108.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  }
}
```

- [ ] **Step 2: Create `nova-mac/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals", "node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["shared/*"] }
  },
  "include": ["electron", "src", "shared"]
}
```

- [ ] **Step 3: Create `nova-mac/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
  },
  resolve: { alias: { "@shared": new URL("./shared", import.meta.url).pathname } },
});
```

- [ ] **Step 4: Create `nova-mac/electron.vite.config.ts`**

```ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { build: { outDir: "out/main", lib: { entry: "electron/main.ts" } } },
  preload: { build: { outDir: "out/preload", lib: { entry: "electron/preload.ts" } } },
  renderer: {
    plugins: [react()],
    build: { outDir: "out/renderer" },
    resolve: { alias: { "@shared": new URL("./shared", import.meta.url).pathname } },
  },
});
```

- [ ] **Step 5: Create `nova-mac/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Nova</title></head>
  <body style="margin:0;background:transparent;overflow:hidden;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `nova-mac/src/main.tsx` and `nova-mac/src/App.tsx`**

`src/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

`src/App.tsx`:
```tsx
export function App() {
  return <div style={{ color: "white", padding: 16 }}>Nova booting…</div>;
}
```

- [ ] **Step 7: Create `nova-mac/.gitignore`**

```
node_modules/
out/
dist/
.env
build/*.node
```

- [ ] **Step 8: Write the failing test for shared types**

`shared/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { IpcChannel } from "./types";

describe("IpcChannel", () => {
  it("defines the foundation channels", () => {
    expect(IpcChannel.Ping).toBe("ping");
    expect(IpcChannel.AuthStatus).toBe("auth:status");
    expect(IpcChannel.AuthSignIn).toBe("auth:signIn");
    expect(IpcChannel.SyncConversations).toBe("sync:conversations");
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `cd nova-mac && npm install && npm run test`
Expected: FAIL — `Cannot find module './types'` (file not yet created).

- [ ] **Step 10: Create `nova-mac/shared/types.ts` to pass**

```ts
export enum IpcChannel {
  Ping = "ping",
  AuthStatus = "auth:status",
  AuthSignIn = "auth:signIn",
  AuthSignOut = "auth:signOut",
  AuthChanged = "auth:changed",
  SyncConversations = "sync:conversations",
  SyncMemories = "sync:memories",
}

export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface MemorySummary {
  id: string;
  content: string;
  type: string;
  salience: number;
}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd nova-mac && npm run test`
Expected: PASS (1 test).

- [ ] **Step 12: Commit**

```bash
git add nova-mac/package.json nova-mac/tsconfig.json nova-mac/vitest.config.ts \
  nova-mac/electron.vite.config.ts nova-mac/index.html nova-mac/src nova-mac/shared nova-mac/.gitignore
git commit -m "feat(mac): scaffold Electron+Vite+TS+Vitest project with shared IPC types"
```

---

### Task 2: Transparent always-on-top orb window + tray

**Files:**
- Create: `nova-mac/electron/main.ts`, `nova-mac/electron/window.ts`, `nova-mac/electron/tray.ts`
- Create: `nova-mac/build/trayTemplate.png` (16×16 black-on-transparent dot; placeholder asset)

**Interfaces:**
- Consumes: nothing.
- Produces: `createOrbWindow(): BrowserWindow` (from `window.ts`), `createTray(win: BrowserWindow): Tray` (from `tray.ts`).

- [ ] **Step 1: Create `nova-mac/electron/window.ts`**

```ts
import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    vibrancy: "under-window",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}
```

- [ ] **Step 2: Create `nova-mac/electron/tray.ts`**

```ts
import { Tray, Menu, nativeImage, app, type BrowserWindow } from "electron";
import { join } from "node:path";

export function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(
    join(import.meta.dirname, "../../build/trayTemplate.png"),
  );
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip("Nova");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Nova", click: () => win.show() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => (win.isVisible() ? win.hide() : win.show()));
  return tray;
}
```

- [ ] **Step 3: Create `nova-mac/electron/main.ts`**

```ts
import { app, BrowserWindow, globalShortcut } from "electron";
import { createOrbWindow } from "./window";
import { createTray } from "./tray";

let win: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let trayRef: ReturnType<typeof createTray> | null = null;

app.dock?.hide(); // no Dock icon — tray-only

app.whenReady().then(() => {
  win = createOrbWindow();
  trayRef = createTray(win);
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
  win.once("ready-to-show", () => console.log("[nova] window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// Tray-only app: do not quit when the window closes.
app.on("window-all-closed", () => {});
```

- [ ] **Step 4: Add a placeholder tray asset**

Run (creates a 16×16 transparent PNG with a black dot via macOS `sips`/Python fallback):
```bash
cd nova-mac && mkdir -p build && python3 - <<'PY'
import struct, zlib, os
# 16x16 RGBA: opaque black dot centered, transparent elsewhere
W=H=16; data=bytearray()
for y in range(H):
    data.append(0)  # filter byte per row
    for x in range(W):
        d=((x-7.5)**2+(y-7.5)**2)**0.5
        a=255 if d<5 else 0
        data += bytes([0,0,0,a])
raw=zlib.compress(bytes(data))
def chunk(t,b): return struct.pack(">I",len(b))+t+b+struct.pack(">I",zlib.crc32(t+b)&0xffffffff)
png=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",W,H,8,6,0,0,0))+chunk(b"IDAT",raw)+chunk(b"IEND",b"")
open("build/trayTemplate.png","wb").write(png)
print("wrote build/trayTemplate.png")
PY
```
Expected: `wrote build/trayTemplate.png`

- [ ] **Step 5: Launch the app to verify the window + tray appear**

Run: `cd nova-mac && npm run dev`
Expected (manual verification): no Dock icon; a dot appears in the menu-bar tray; pressing `Cmd+Shift+Space` toggles a transparent window showing "Nova booting…"; terminal logs `[nova] window ready`. Press `Ctrl+C` to stop.

- [ ] **Step 6: Commit**

```bash
git add nova-mac/electron nova-mac/build/trayTemplate.png
git commit -m "feat(mac): transparent always-on-top orb window + tray + global hotkey"
```

---

### Task 3: Typed IPC bridge (preload + contextBridge) with a ping smoke channel

**Files:**
- Create: `nova-mac/electron/preload.ts`, `nova-mac/electron/ipc.ts`, `nova-mac/src/lib/ipc.ts`
- Modify: `nova-mac/electron/main.ts` (register IPC handlers), `nova-mac/src/App.tsx` (call ping)
- Test: `nova-mac/electron/ipc.test.ts`

**Interfaces:**
- Consumes: `IpcChannel` from `shared/types.ts`.
- Produces:
  - `registerIpcHandlers(handlers: IpcHandlers): void` (from `ipc.ts`), where `IpcHandlers` is `{ ping(): Promise<string>; authStatus(): Promise<AuthState>; ... }` — later tasks add fields.
  - `window.nova` on the renderer with `ping(): Promise<string>`.

- [ ] **Step 1: Write the failing test for the handler registry**

`electron/ipc.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc";
import { IpcChannel } from "@shared/types";

describe("registerIpcHandlers", () => {
  it("registers a handler for every provided channel", () => {
    registerIpcHandlers({ ping: async () => "pong" });
    expect(ipcMain.handle).toHaveBeenCalledWith(IpcChannel.Ping, expect.any(Function));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- ipc`
Expected: FAIL — `Cannot find module './ipc'`.

- [ ] **Step 3: Create `nova-mac/electron/ipc.ts`**

```ts
import { ipcMain } from "electron";
import { IpcChannel, type AuthState } from "@shared/types";

export interface IpcHandlers {
  ping(): Promise<string>;
  authStatus?(): Promise<AuthState>;
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IpcChannel.Ping, () => handlers.ping());
  if (handlers.authStatus) {
    ipcMain.handle(IpcChannel.AuthStatus, () => handlers.authStatus!());
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- ipc`
Expected: PASS.

- [ ] **Step 5: Create `nova-mac/electron/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/types";

contextBridge.exposeInMainWorld("nova", {
  ping: (): Promise<string> => ipcRenderer.invoke(IpcChannel.Ping),
});
```

- [ ] **Step 6: Create `nova-mac/src/lib/ipc.ts` (renderer-side typed accessor)**

```ts
export interface NovaBridge {
  ping(): Promise<string>;
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
```

- [ ] **Step 7: Register handlers in `main.ts`**

Add the import and call inside `app.whenReady().then(...)`, before creating the window:
```ts
import { registerIpcHandlers } from "./ipc";
// ...inside whenReady, first line:
registerIpcHandlers({ ping: async () => "pong" });
```

- [ ] **Step 8: Call ping from `src/App.tsx` to verify the bridge end-to-end**

```tsx
import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";

export function App() {
  const [reply, setReply] = useState("…");
  useEffect(() => { nova().ping().then(setReply); }, []);
  return <div style={{ color: "white", padding: 16 }}>Nova: {reply}</div>;
}
```

- [ ] **Step 9: Launch to verify the round-trip**

Run: `cd nova-mac && npm run dev`
Expected: window shows "Nova: pong" (renderer invoked main over the contextBridge).

- [ ] **Step 10: Commit**

```bash
git add nova-mac/electron/ipc.ts nova-mac/electron/ipc.test.ts nova-mac/electron/preload.ts \
  nova-mac/electron/main.ts nova-mac/src/lib/ipc.ts nova-mac/src/App.tsx
git commit -m "feat(mac): typed IPC bridge with ping smoke channel"
```

---

### Task 4: Keychain session store via safeStorage

**Files:**
- Create: `nova-mac/electron/session-store.ts`
- Test: `nova-mac/electron/session-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `saveSession(tokens: StoredSession): void`
  - `loadSession(): StoredSession | null`
  - `clearSession(): void`
  - `interface StoredSession { access_token: string; refresh_token: string }`

- [ ] **Step 1: Write the failing test**

`electron/session-store.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const files: Record<string, string> = {};
vi.mock("node:fs", () => ({
  writeFileSync: (p: string, d: string) => { files[p] = d; },
  readFileSync: (p: string) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
  existsSync: (p: string) => p in files,
  rmSync: (p: string) => { delete files[p]; },
}));
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nova-test" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from("enc:" + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  },
}));

import { saveSession, loadSession, clearSession } from "./session-store";

beforeEach(() => { for (const k of Object.keys(files)) delete files[k]; });

describe("session-store", () => {
  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
  });
  it("round-trips a session through encryption", () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    expect(loadSession()).toEqual({ access_token: "a", refresh_token: "r" });
  });
  it("clears a stored session", () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- session-store`
Expected: FAIL — `Cannot find module './session-store'`.

- [ ] **Step 3: Create `nova-mac/electron/session-store.ts`**

```ts
import { app, safeStorage } from "electron";
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface StoredSession {
  access_token: string;
  refresh_token: string;
}

function file(): string {
  return join(app.getPath("userData"), "session.bin");
}

export function saveSession(tokens: StoredSession): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Keychain encryption unavailable");
  }
  const enc = safeStorage.encryptString(JSON.stringify(tokens));
  writeFileSync(file(), enc.toString("base64"), "utf8");
}

export function loadSession(): StoredSession | null {
  const p = file();
  if (!existsSync(p)) return null;
  try {
    const buf = Buffer.from(readFileSync(p, "utf8"), "base64");
    return JSON.parse(safeStorage.decryptString(buf)) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  const p = file();
  if (existsSync(p)) rmSync(p);
}
```

> Note: the test mocks `node:fs` without base64 round-trip concerns by stubbing `Buffer` usage through the mocked `safeStorage`; `loadSession` tolerates decode failure by returning null.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- session-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nova-mac/electron/session-store.ts nova-mac/electron/session-store.test.ts
git commit -m "feat(mac): Keychain-backed session store via safeStorage"
```

---

### Task 5: Supabase client + magic-link auth via system browser + deep-link callback

**Files:**
- Create: `nova-mac/electron/supabase.ts`, `nova-mac/electron/auth.ts`
- Modify: `nova-mac/electron/main.ts` (register protocol, wire auth handlers), `nova-mac/electron/ipc.ts` (add auth channels), `nova-mac/electron/preload.ts` (expose auth), `nova-mac/src/lib/ipc.ts` (types), `nova-mac/package.json`/`electron-builder.json` (register `nova://` scheme), `nova-mac/.env.example`

**Interfaces:**
- Consumes: `StoredSession`, `saveSession`, `loadSession`, `clearSession`; `AuthState`, `IpcChannel`.
- Produces:
  - `getSupabase(): SupabaseClient` (singleton, from `supabase.ts`)
  - `startSignIn(email: string): Promise<void>` — sends magic link with `emailRedirectTo: "nova://auth-callback"`
  - `handleAuthCallback(url: string): Promise<void>` — exchanges code, persists session, emits `AuthChanged`
  - `getAuthState(): Promise<AuthState>`
  - `signOut(): Promise<void>`
  - `restoreSession(): Promise<void>` — loads from Keychain on launch

- [ ] **Step 1: Create `nova-mac/.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 2: Create `nova-mac/electron/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  return client;
}
```

- [ ] **Step 3: Create `nova-mac/electron/auth.ts`**

```ts
import { shell, BrowserWindow } from "electron";
import { getSupabase } from "./supabase";
import { saveSession, loadSession, clearSession } from "./session-store";
import { IpcChannel, type AuthState } from "@shared/types";

function emit(channel: IpcChannel, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

export async function startSignIn(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "nova://auth-callback" },
  });
  if (error) throw error;
}

export async function handleAuthCallback(url: string): Promise<void> {
  // url looks like nova://auth-callback#access_token=...&refresh_token=...
  const hash = url.split("#")[1] ?? "";
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return;
  const { error } = await getSupabase().auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  saveSession({ access_token, refresh_token });
  emit(IpcChannel.AuthChanged, await getAuthState());
}

export async function restoreSession(): Promise<void> {
  const stored = loadSession();
  if (!stored) return;
  await getSupabase().auth.setSession(stored);
}

export async function getAuthState(): Promise<AuthState> {
  const { data } = await getSupabase().auth.getUser();
  return { signedIn: !!data.user, email: data.user?.email ?? null };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  clearSession();
  emit(IpcChannel.AuthChanged, { signedIn: false, email: null });
}
```

- [ ] **Step 4: Extend `nova-mac/electron/ipc.ts` with auth channels**

Replace the `IpcHandlers` interface and body with:
```ts
import { ipcMain } from "electron";
import { IpcChannel, type AuthState } from "@shared/types";

export interface IpcHandlers {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IpcChannel.Ping, () => handlers.ping());
  ipcMain.handle(IpcChannel.AuthStatus, () => handlers.authStatus());
  ipcMain.handle(IpcChannel.AuthSignIn, (_e, email: string) => handlers.authSignIn(email));
  ipcMain.handle(IpcChannel.AuthSignOut, () => handlers.authSignOut());
}
```

> The Task 3 ipc test still passes (ping handler still registered). Update its assertion set if desired, but it is not required.

- [ ] **Step 5: Expose auth in `preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/types";

contextBridge.exposeInMainWorld("nova", {
  ping: () => ipcRenderer.invoke(IpcChannel.Ping),
  authStatus: () => ipcRenderer.invoke(IpcChannel.AuthStatus),
  authSignIn: (email: string) => ipcRenderer.invoke(IpcChannel.AuthSignIn, email),
  authSignOut: () => ipcRenderer.invoke(IpcChannel.AuthSignOut),
  onAuthChanged: (cb: (s: unknown) => void) =>
    ipcRenderer.on(IpcChannel.AuthChanged, (_e, s) => cb(s)),
});
```

- [ ] **Step 6: Update renderer types in `src/lib/ipc.ts`**

```ts
import type { AuthState } from "@shared/types";

export interface NovaBridge {
  ping(): Promise<string>;
  authStatus(): Promise<AuthState>;
  authSignIn(email: string): Promise<void>;
  authSignOut(): Promise<void>;
  onAuthChanged(cb: (s: AuthState) => void): void;
}

declare global {
  interface Window { nova: NovaBridge }
}

export const nova = (): NovaBridge => window.nova;
```

- [ ] **Step 7: Register the `nova://` protocol + deep-link handling in `main.ts`**

Add near the top (before `app.whenReady`):
```ts
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";

app.setAsDefaultProtocolClient("nova");
// macOS delivers deep links via open-url
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url.startsWith("nova://auth-callback")) void handleAuthCallback(url);
});
```
Replace the `registerIpcHandlers({ ping: ... })` call with:
```ts
registerIpcHandlers({
  ping: async () => "pong",
  authStatus: getAuthState,
  authSignIn: startSignIn,
  authSignOut: signOut,
});
await restoreSession();
```
(Make the `whenReady` callback `async`.)

- [ ] **Step 8: Register the URL scheme for packaging in `electron-builder.json`**

Create `nova-mac/electron-builder.json` (expanded in Task 7; the protocol block is needed now for dev parity documentation):
```json
{
  "appId": "com.nova.mac",
  "productName": "Nova",
  "protocols": [{ "name": "Nova", "schemes": ["nova"] }]
}
```

- [ ] **Step 9: Verify the existing tests still pass and build typechecks**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: all tests PASS; `tsc` reports zero errors.

- [ ] **Step 10: Manual sign-in verification**

Populate `nova-mac/.env` from `.env.example` with the same Supabase project as the web app. In the Supabase dashboard, add `nova://auth-callback` to Auth → URL Configuration → Redirect URLs.
Run: `cd nova-mac && npm run dev`, then in the renderer temporarily call `nova().authSignIn("aryavkarthikk@gmail.com")` (devtools console). Expected: a magic-link email arrives; clicking it opens `nova://auth-callback`, the app receives `open-url`, and `auth:changed` fires with `signedIn: true`.

- [ ] **Step 11: Commit**

```bash
git add nova-mac/electron/supabase.ts nova-mac/electron/auth.ts nova-mac/electron/ipc.ts \
  nova-mac/electron/preload.ts nova-mac/electron/main.ts nova-mac/src/lib/ipc.ts \
  nova-mac/electron-builder.json nova-mac/.env.example
git commit -m "feat(mac): Supabase magic-link auth via system browser + nova:// deep-link callback"
```

---

### Task 6: Read existing conversations + memories (sync proof) and render an auth-gated view

**Files:**
- Create: `nova-mac/electron/sync.ts`
- Modify: `nova-mac/electron/ipc.ts`, `nova-mac/electron/preload.ts`, `nova-mac/src/lib/ipc.ts`, `nova-mac/src/App.tsx`, `nova-mac/electron/main.ts`
- Test: `nova-mac/electron/sync.test.ts`

**Interfaces:**
- Consumes: `getSupabase`; `ConversationSummary`, `MemorySummary`, `IpcChannel`.
- Produces:
  - `listConversations(limit?: number): Promise<ConversationSummary[]>`
  - `listMemories(limit?: number): Promise<MemorySummary[]>`
  - Both exclude the `embedding` column (per spec: never transfer 6KB float vectors).

- [ ] **Step 1: Write the failing test (mock Supabase query builder)**

`electron/sync.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

const rows = {
  conversations: [{ id: "c1", title: "Hi", updated_at: "2026-06-01T00:00:00Z" }],
  memories: [{ id: "m1", content: "User likes tea", type: "preference", salience: 0.8 }],
};

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (table: keyof typeof rows) => ({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: rows[table], error: null }),
        }),
      }),
    }),
  }),
}));

import { listConversations, listMemories } from "./sync";

describe("sync", () => {
  it("maps conversation rows to summaries", async () => {
    const out = await listConversations();
    expect(out).toEqual([{ id: "c1", title: "Hi", updatedAt: "2026-06-01T00:00:00Z" }]);
  });
  it("maps memory rows to summaries", async () => {
    const out = await listMemories();
    expect(out[0]).toEqual({ id: "m1", content: "User likes tea", type: "preference", salience: 0.8 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- sync`
Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 3: Create `nova-mac/electron/sync.ts`**

```ts
import { getSupabase } from "./supabase";
import type { ConversationSummary, MemorySummary } from "@shared/types";

export async function listConversations(limit = 50): Promise<ConversationSummary[]> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function listMemories(limit = 50): Promise<MemorySummary[]> {
  // NOTE: never select `embedding` — it is ~6KB of floats per row.
  const { data, error } = await getSupabase()
    .from("memories")
    .select("id, content, type, salience")
    .order("salience", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, content: r.content, type: r.type, salience: r.salience,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- sync`
Expected: PASS (2 tests).

- [ ] **Step 5: Add sync channels to `ipc.ts`**

Extend `IpcHandlers` and registration:
```ts
import { IpcChannel, type AuthState } from "@shared/types";
import type { ConversationSummary, MemorySummary } from "@shared/types";
// add to interface:
//   syncConversations(): Promise<ConversationSummary[]>;
//   syncMemories(): Promise<MemorySummary[]>;
// add to registerIpcHandlers body:
ipcMain.handle(IpcChannel.SyncConversations, () => handlers.syncConversations());
ipcMain.handle(IpcChannel.SyncMemories, () => handlers.syncMemories());
```

- [ ] **Step 6: Expose sync in `preload.ts` and `src/lib/ipc.ts`**

`preload.ts` — add inside `exposeInMainWorld`:
```ts
  syncConversations: () => ipcRenderer.invoke(IpcChannel.SyncConversations),
  syncMemories: () => ipcRenderer.invoke(IpcChannel.SyncMemories),
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  syncConversations(): Promise<import("@shared/types").ConversationSummary[]>;
  syncMemories(): Promise<import("@shared/types").MemorySummary[]>;
```

- [ ] **Step 7: Wire handlers in `main.ts`**

Add to the `registerIpcHandlers({...})` object:
```ts
  syncConversations: () => import("./sync").then((m) => m.listConversations()),
  syncMemories: () => import("./sync").then((m) => m.listMemories()),
```

- [ ] **Step 8: Render an auth-gated view in `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState, ConversationSummary, MemorySummary } from "@shared/types";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });
  const [email, setEmail] = useState("");
  const [convos, setConvos] = useState<ConversationSummary[]>([]);
  const [mems, setMems] = useState<MemorySummary[]>([]);

  useEffect(() => {
    nova().authStatus().then(setAuth);
    nova().onAuthChanged(setAuth);
  }, []);

  useEffect(() => {
    if (!auth.signedIn) return;
    nova().syncConversations().then(setConvos);
    nova().syncMemories().then(setMems);
  }, [auth.signedIn]);

  if (!auth.signedIn) {
    return (
      <div style={{ color: "white", padding: 16 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
        <button onClick={() => nova().authSignIn(email)}>Send magic link</button>
      </div>
    );
  }

  return (
    <div style={{ color: "white", padding: 16 }}>
      <div>Signed in as {auth.email}</div>
      <div>{convos.length} conversations · {mems.length} memories</div>
    </div>
  );
}
```

- [ ] **Step 9: Verify tests, typecheck, and live sync**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: all PASS, zero type errors.
Then `npm run dev`, sign in, and confirm the view shows a non-zero conversation/memory count pulled from the same Supabase project the web app uses.

- [ ] **Step 10: Commit**

```bash
git add nova-mac/electron/sync.ts nova-mac/electron/sync.test.ts nova-mac/electron/ipc.ts \
  nova-mac/electron/preload.ts nova-mac/electron/main.ts nova-mac/src/lib/ipc.ts nova-mac/src/App.tsx
git commit -m "feat(mac): read conversations + memories from Supabase with auth-gated view"
```

---

### Task 7: Code signing + notarization with a native-addon probe (de-risk the riskiest infra)

**Files:**
- Create: `nova-mac/electron/native-probe/binding.gyp`, `nova-mac/electron/native-probe/probe.c`, `nova-mac/electron/native-probe/index.ts`
- Modify: `nova-mac/electron-builder.json`, `nova-mac/package.json` (add `node-gyp`/`node-addon-api`, dist script), `nova-mac/electron/main.ts` (call probe at startup), `nova-mac/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `probeNative(): string` returning `"native-ok"` — proves a compiled native addon survives signing + notarization (the same machinery `nut-js` and the audio addon need in later plans).

- [ ] **Step 1: Add native build deps to `package.json`**

In `devDependencies` add:
```json
    "node-addon-api": "^8.2.0",
    "node-gyp": "^10.2.0"
```
In `dependencies` add:
```json
    "bindings": "^1.5.0"
```

- [ ] **Step 2: Create the native probe `nova-mac/electron/native-probe/probe.c`**

```c
#include <node_api.h>

static napi_value Probe(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "native-ok", NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, Probe, NULL, &fn);
  napi_set_named_property(env, exports, "probe", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

- [ ] **Step 3: Create `nova-mac/electron/native-probe/binding.gyp`**

```python
{
  "targets": [
    {
      "target_name": "probe",
      "sources": ["probe.c"]
    }
  ]
}
```

- [ ] **Step 4: Create the TS wrapper `nova-mac/electron/native-probe/index.ts`**

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function probeNative(): string {
  // Loaded lazily so dev without a build still boots.
  const addon = require("bindings")("probe") as { probe(): string };
  return addon.probe();
}
```

- [ ] **Step 5: Build the addon and verify it loads**

Run:
```bash
cd nova-mac/electron/native-probe && npx node-gyp configure build && \
node -e "console.log(require('bindings')('probe').probe())"
```
Expected: prints `native-ok`.

- [ ] **Step 6: Call the probe at startup (non-fatal) in `main.ts`**

Add inside `whenReady`, after `registerIpcHandlers`:
```ts
try {
  const { probeNative } = await import("./native-probe/index.js");
  console.log("[nova] native probe:", probeNative());
} catch (e) {
  console.warn("[nova] native probe unavailable in dev:", (e as Error).message);
}
```

- [ ] **Step 7: Expand `electron-builder.json` for signing + notarization**

```json
{
  "appId": "com.nova.mac",
  "productName": "Nova",
  "protocols": [{ "name": "Nova", "schemes": ["nova"] }],
  "asarUnpack": ["**/*.node"],
  "files": ["out/**", "build/**", "package.json"],
  "mac": {
    "category": "public.app-category.productivity",
    "target": ["dmg"],
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "notarize": true
  }
}
```

- [ ] **Step 8: Create `nova-mac/build/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict>
</plist>
```

- [ ] **Step 9: Document the signing/notarization workflow in `nova-mac/README.md`**

Include exact env vars and command:
```markdown
## Build & notarize (macOS)

Requires an Apple Developer ID. Set in the shell or CI:
- `CSC_LINK` — base64 or path to the Developer ID Application .p12
- `CSC_KEY_PASSWORD` — .p12 password
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — for notarization

Build a signed, notarized .dmg:
```bash
npm run dist
```
The native probe is bundled (`asarUnpack` keeps `.node` files outside the asar).
A successful run logs `[nova] native probe: native-ok` on first launch of the
installed app — confirming the compiled addon survived signing + notarization.
```

- [ ] **Step 10: Produce a signed build and verify the probe in the packaged app**

Run (with signing env vars set): `cd nova-mac && npm run dist`
Expected: `dist/Nova-0.1.0.dmg` is produced; `spctl -a -vvv "dist/mac/Nova.app"` reports `accepted` / `source=Notarized Developer ID`. Launching the installed app logs `[nova] native probe: native-ok`.

> If no Developer ID is available in this environment, mark Step 10 as blocked and record it — the unsigned `electron-vite build` (`npm run build`) plus the local addon load in Step 5 still prove the addon compiles and loads; notarization is then verified on a machine/CI that has the certificate.

- [ ] **Step 11: Commit**

```bash
git add nova-mac/electron/native-probe nova-mac/electron-builder.json \
  nova-mac/build/entitlements.mac.plist nova-mac/electron/main.ts \
  nova-mac/package.json nova-mac/README.md
git commit -m "feat(mac): native-addon probe + signing/notarization config to de-risk packaging"
```

---

## Self-Review

**Spec coverage (Plan 1 scope = §11 phases 1–2 + §8 auth/sync):**
- §1 process model (main owns access, sandboxed renderer, contextBridge) → Tasks 2, 3 ✓
- §1 standalone app, no Next import → file structure + Global Constraints ✓
- §8 magic-link auth, system browser, Keychain via safeStorage → Tasks 4, 5 ✓
- §8 direct supabase-js against existing tables, embedding excluded → Task 6 ✓
- §8 distribution: signing, notarization, electron-builder, entitlements → Task 7 ✓
- §11 phase 1 "signing spike proven with a native addon stub" → Task 7 ✓
- §9 transparent always-on-top window, no Dock icon, tray-only → Task 2 ✓
- Hotkey `Cmd+Shift+Space` (§2 summon path) → Task 2 ✓

Deferred to later plans (correctly out of scope here): orb states + chat sheet (Plan 2), wake word (Plan 2), voice (Plan 2), screen context (Plan 3), chat/tools + memory-write pipeline (Plan 3), computer-use loop (Plan 3), gated cleanup + onboarding permission flow (Plan 4), auto-update (Plan 4).

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — all steps contain concrete code or exact commands. The single blocked-path note in Task 7 Step 10 is an explicit environment caveat, not a placeholder.

**Type consistency:** `IpcChannel` enum values, `AuthState`/`ConversationSummary`/`MemorySummary` shapes, `StoredSession`, and the `IpcHandlers`/`NovaBridge` method names (`ping`, `authStatus`, `authSignIn`, `authSignOut`, `onAuthChanged`, `syncConversations`, `syncMemories`) are consistent across `shared/types.ts`, `ipc.ts`, `preload.ts`, and `src/lib/ipc.ts`. `probeNative()` returns `"native-ok"` consistently in Tasks 6–7.
