# Nova Mac Plan 4 — Conversation Polish + Full UI Design Spec

**Date:** 2026-07-01  
**Branch:** `feat/phase-4e-mac-plan4`  
**Working directory:** `nova-mac/`

---

## Goal

Bring the Nova Mac Electron app from a bare tray orb to a fully-featured companion app with feature parity with the web app: fixed barge-in, lower latency, a canvas orb that matches the web app's visual design, Apple liquid glass aesthetics, text input, and a full expanded-window UI with Reminders, Memory, Connections, and Settings tabs.

---

## Architecture overview

### Two-mode window model

**Compact (orb) — always visible when signed in:**
- 480×600, frameless, transparent, always-on-top, no Dock icon
- Shows the animated canvas orb, last transcript, and a text composer below
- Gear icon (⚙) in top-right corner → opens expanded window
- All voice interaction stays here

**Expanded (app window) — opens on demand:**
- 920×680, standard macOS window, vibrancy `under-window`, appears in Dock
- Orb window hides when expanded opens; shows again when expanded closes
- Navigation: floating pill dock at bottom matching web app's `AppDock`
- Tabs: Orb · Reminders · Memory · Connections · Settings · Sign out

### Four implementation phases (sequential)

- **Phase A — Voice polish**: barge-in fix, latency earcon, continuous conversation, orb error states
- **Phase B — Orb + compact UI overhaul**: canvas orb matching web app, liquid glass shell, text composer
- **Phase C — App shell + expanded window**: second window, navigation dock, Tailwind in renderer
- **Phase D — Settings, Reminders, Memory, Connections tabs**: all four tab pages

---

## Design system

### Tailwind CSS in renderer

Add `tailwindcss` + `autoprefixer` + `postcss` to `nova-mac` devDependencies. Configure `tailwind.config.ts` with `content: ["./src/**/*.{tsx,ts}"]`. Add `postcss.config.js`. Import Tailwind in `src/styles/global.css` (alongside existing `glass.css`).

### CSS tokens (match web app exactly)

```css
:root {
  --nova-bg: #080808;
  --nova-surface: rgb(16 16 16 / 88%);
  --nova-border: rgb(255 255 255 / 8%);
  --nova-border-strong: rgb(255 255 255 / 14%);
  --nova-text: #e8e8ed;
  --nova-text-secondary: #8b9099;
  --nova-accent: #0a84ff;
  --nova-radius-card: 16px;
  --nova-radius-pill: 24px;
  --nova-shadow-dock: 0 12px 40px rgb(0 0 0 / 45%), inset 0 1px 0 rgb(255 255 255 / 6%);
}
```

### Liquid glass treatment

The orb window has native macOS `vibrancy: "under-window"` + `transparent: true`. UI elements use:
```css
.nova-glass {
  background: rgb(16 16 16 / 72%);
  backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgb(255 255 255 / 10%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 12%), 0 0 0 0.5px rgb(0 0 0 / 30%);
}
```

### Shared UI primitives (port from web app)

Create `src/components/ui/` with: `Button`, `Card`, `Badge`, `Notice`, `Select` — matching the web app's `components/ui/primitives` visual style.

---

## Phase A — Voice polish

### Files modified
- `src/hooks/useVoice.ts` — barge-in wiring, continuous conversation, error states, earcon
- `electron/voice/preferences.ts` — load full `VoicePreferences` from Supabase
- `shared/types.ts` — add `PrefsGet`/`PrefsSet` IPC channels

### Barge-in fix

The `TtsBargeInListener` in `src/voice/tts-barge-in.ts` is structurally correct. The bug is in `useVoice.ts`: the listener is either not started with the correct live mic stream during TTS playback, or `bargeInEnabled` is not being read from preferences (defaults to `false`).

Fix: in `useVoice.ts`, after TTS playback begins (`player.playStreaming()`), call:
```typescript
if (prefs.bargeInEnabled) {
  bargeInListenerRef.current = new TtsBargeInListener(
    ttsBargeInConfigFromSensitivity(prefs.bargeInSensitivity)
  );
  bargeInListenerRef.current.start(micStreamRef.current, () => {
    // stop TTS, cancel chat, restart turn
    player.stop();
    nova().chatCancel(requestIdRef.current);
    void runTurn();
  });
}
```
Stop the listener when TTS ends or turn ends.

### Latency — instant ack

When wake word fires (WakeDetected IPC event), before mic re-acquire:
- If `prefs.instantAckMode === "earcon"`: play a soft tick audio buffer (embedded base64 WAV, ~80ms)
- If `prefs.instantAckMode === "spoken"` / `prefs.instantAck === true`: prepend "Got it." to TTS queue

### Continuous conversation

After TTS playback completes, if `prefs.interactionMode === "conversation"`:
- Do not call `endTurn()` (which re-arms wake word)
- Instead automatically call `runTurn()` again (start listening for follow-up)
- Show orb in `listening` state immediately

### Robustness — error states

Replace all `dispatch({ type: "dismiss" })` silent failures with:
```typescript
dispatch({ type: "error", message: "Mic unavailable" }); // or "Nothing heard" / "Transcription failed"
```
The orb machine already has an `error` state. Add a brief 2s auto-dismiss after showing the error.

---

## Phase B — Orb + compact UI overhaul

### Files modified/created
- `src/components/orb/Orb.tsx` — replace with canvas-based orb matching web app
- `src/components/orb/VoiceOrb.tsx` — port of `components/voice/VoiceOrb.tsx` exactly
- `src/components/orb/VoiceOverlay.tsx` — port of `components/voice/VoiceOverlay.tsx`
- `src/components/composer/TextComposer.tsx` — new text input component
- `src/styles/glass.css` — updated liquid glass tokens
- `src/styles/voice.css` — port all `app-voice-*` CSS classes from web app
- `electron/window.ts` — compact window size stays 480×600

### Canvas orb (VoiceOrb)

Exact port of web app's `components/voice/VoiceOrb.tsx`:
- Six state palettes: `idle`, `listening`, `barge_in`, `processing`, `thinking`, `speaking`
- Canvas 400×400, animated blob layers, radial gradients, rim stroke, reactive rings
- `visualMode` driven by orb-machine state (map orb states → visual modes)

State mapping:
```typescript
function toVisualMode(state: OrbState): VoiceVisualMode {
  if (state.phase === "dormant") return "idle";
  if (state.phase === "listening") return "listening";
  if (state.phase === "processing") return "processing";
  if (state.phase === "responding") return "speaking";
  if (state.phase === "working") return "thinking";
  if (state.phase === "bargeIn") return "barge_in";
  return "idle";
}
```

### Voice overlay

Port `components/voice/VoiceOverlay.tsx` — full-screen clip-path expansion from orb center when voice session is active:
- Orb as full-screen ambient backdrop
- NOVA identity top-left, status top-right
- Mode label + transcript + waveform at bottom
- Stop / Settings controls
- Memory flash rings (AnimatePresence)

### Text composer

Below the orb in compact mode, a text input bar:
```
[  Type a message…                           ↵ ]
```
- Hidden by default; appears on click of orb when dormant, or on any printable keypress
- On Enter: `nova().chatSend({ requestId, messages: [{ role: "user", content }], inputModality: "text" })`
- Response streams into transcript area below orb; TTS skipped if `prefs.spokenReplies === false`
- Escape or submit → hides composer

### Gear icon

Small `⚙` button top-right of compact window → calls new `nova().appOpen()` IPC → main process shows expanded window, hides orb window.

---

## Phase C — App shell + expanded window

### Files created/modified
- `electron/window.ts` — add `createAppWindow()` alongside `createOrbWindow()`
- `electron/main.ts` — wire `AppOpen`/`AppClose` IPC, tray "Open Nova" menu item
- `electron/ipc.ts` — register `AppOpen`/`AppClose` handlers
- `electron/preload.ts` — expose `appOpen()`, `appClose()` on `window.nova`
- `shared/types.ts` — add `IpcChannel.AppOpen`, `IpcChannel.AppClose`
- `src/AppShell.tsx` — new root component for expanded window (with tab routing)
- `src/components/dock/AppDock.tsx` — floating pill dock, port of web app's `AppDock`
- `src/pages/OrbPage.tsx` — "return to orb" page (just closes expanded window)
- Separate renderer entry for the app window, or use hash routing within the single renderer

### Expanded window spec
```typescript
export function createAppWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    frame: true,
    transparent: false,
    vibrancy: "under-window",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#080808",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
}
```

### Navigation dock

**Exact port** of the web app's `FloatingDock` + `AppDock` into the renderer.

**`src/components/ui/floating-dock.tsx`** — copy of web app's `components/ui/floating-dock.tsx` with one adaptation: items use `onClick: () => void` instead of `href: string` (no page routing in Electron). The macOS-dock magnification effect (mouse proximity spring zoom, `useMotionValue` / `useSpring` / `useTransform`) is preserved exactly.

```typescript
// Adapted item type for Electron
type DockItem = { title: string; icon: React.ReactNode; onClick: () => void };
```

**Dependencies to add:**
- `@tabler/icons-react` — same icons as web app (IconMessage, IconBell, IconBrain, IconPlugConnected, IconSettings, IconLogout)
- `clsx` + `tailwind-merge` → `src/lib/utils.ts` with `cn()` helper (same as web app)

**`src/components/dock/AppDock.tsx`** — port of web app's `AppDock`:
```typescript
const items: DockItem[] = [
  { title: "Orb",         icon: <IconMicrophone />, onClick: () => nova().appClose() },
  { title: "Reminders",   icon: <IconBell />,        onClick: () => setTab("reminders") },
  { title: "Memory",      icon: <IconBrain />,       onClick: () => setTab("memory") },
  { title: "Connections", icon: <IconPlugConnected />, onClick: () => setTab("connections") },
  { title: "Settings",    icon: <IconSettings />,    onClick: () => setTab("settings") },
  { title: "Sign out",    icon: <IconLogout />,      onClick: () => nova().authSignOut() },
];
```

Same pill container styling as web app:
```
rounded-[24px] border border-[rgb(255_255_255/8%)] bg-[rgb(16_16_16/88%)] px-4 pb-2.5 pt-2
shadow-[0_12px_40px_rgb(0_0_0/45%),inset_0_1px_0_rgb(255_255_255/6%)] backdrop-blur-xl
```

Positioned fixed at bottom-center of the expanded window.

### Routing

Single renderer bundle (`index.html`). On mount, the renderer calls `nova().getWindowMode()` → returns `"orb" | "app"`. If `"orb"`, render the existing `<App />` (orb + composer). If `"app"`, render `<AppShell />` (expanded window with dock).

Add `IpcChannel.GetWindowMode = "window:get-mode"` and register it in `ipc.ts` — the orb window handler returns `"orb"`, the app window handler returns `"app"`. The handler is registered per-window in `main.ts` using `webContents.id` to distinguish them.

Tab routing within `AppShell` uses React state — no react-router:
```typescript
type Tab = "reminders" | "memory" | "connections" | "settings";
```

---

## Phase D — Tab pages

### IPC channels needed (add to `shared/types.ts` + `electron/ipc.ts` + `electron/preload.ts`)

```typescript
// Preferences
PrefsGet = "prefs:get",         // → VoicePreferences & UserPreferences
PrefsSet = "prefs:set",         // patch → saved VoicePreferences & UserPreferences

// Connections
ConnectionsStatus = "connections:status",   // → GoogleConnectionStatus
ConnectionsConnect = "connections:connect", // { service } → opens OAuth in browser
ConnectionsDisconnect = "connections:disconnect", // { service } → removes token

// Reminders
RemindersGet = "reminders:get",     // → Reminder[]
RemindersDone = "reminders:done",   // { id } → void
RemindersDelete = "reminders:delete", // { id } → void

// Memory
MemorySearch = "memory:search",   // { query } → MemorySearchResult[]
MemoryPin = "memory:pin",         // { id, pinned } → void
MemoryArchive = "memory:archive", // { id, archived } → void
MemoryDelete = "memory:delete",   // { id } → void

// Connections OAuth callback
ConnectionsCallback = "connections:callback", // internal: nova:// deep link → main
```

### Settings tab

Port `VoiceSettingsPanel` + `ProactiveSettingsPanel` into a single `src/pages/SettingsPage.tsx`.

**Voice section** (reads/writes `user_preferences.voice` JSON):
- Interaction mode: Off / Conversation / Wake word (select)
- Wake phrases (textarea, one per line)
- Wake word sensitivity (range 0.35–0.85)
- Speech-to-text: OpenAI / Google (select)
- Text-to-speech: OpenAI / Google / Deepgram (select)
- Reply voice (select, populated by TTS provider)
- Speech speed (range 0.75–2.0)
- Extra expressive voice (checkbox, OpenAI only)
- Speak replies aloud (checkbox)
- Thinking sound: Off / Soft tick / Say "Got it" (select)
- Listening sensitivity (range 0–1)
- Silence before send ms (number input 300–3000)
- Auto-send on end of turn (checkbox)
- Barge-in enabled (checkbox)
- Barge-in sensitivity (range 0–1, shown if enabled)
- Interrupt pause before send ms (number, shown if enabled)
- Max interrupt capture ms (number, shown if enabled)

**Proactive section** (reads/writes `user_preferences` top-level columns):
- Proactive mode: Off / Reminders only / Full (select)
- Daily brief enabled (checkbox)
- Brief time local (time input)
- Timezone (text input)
- Quiet hours start/end (time inputs)

Data flow:
1. `SettingsPage` mounts → calls `nova().prefsGet()` → main reads `user_preferences` from Supabase → returns merged `{ voice: VoicePreferences, proactive: ProactivePrefs }`
2. On any change → calls `nova().prefsSet(patch)` → main upserts to Supabase + re-broadcasts to orb window via `webContents.send(IpcChannel.PrefsChanged, prefs)`
3. Orb window (`useVoice.ts`) listens for `PrefsChanged` → updates local prefs ref without re-render

### Reminders tab

Port `RemindersTab` into `src/pages/RemindersPage.tsx`.

- Load: `nova().remindersGet()` → calls `electron/memory/reminders.ts listReminders(userId, "pending")`
- Mark done: `nova().remindersDone(id)` → calls `completeReminder(id)`
- Delete: `nova().remindersDelete(id)` → calls `deleteReminder(id)`
- Display: grouped by due date, overdue items highlighted in amber

### Memory tab

Port `MemoryManager` into `src/pages/MemoryPage.tsx`.

- Load: `nova().memorySearch({ query: "" })` → returns all memories sorted by salience desc, paginated 50 at a time
- Search: debounced query → `nova().memorySearch({ query })` → hybrid search via `electron/memory/search.ts`
- Pin: `nova().memoryPin({ id, pinned })` → UPDATE `is_pinned`
- Archive: `nova().memoryArchive({ id, archived })` → UPDATE `is_archived`
- Delete: `nova().memoryDelete({ id })` → DELETE from `memories`
- Display: same card-per-memory layout as web app's `MemoryItemRow`

### Connections tab

Port `ConnectionsPage` into `src/pages/ConnectionsPage.tsx`.

**Status load:** `nova().connectionsStatus()` → main reads `google_oauth_tokens` for calendar/gmail/youtube via `electron/google/db-tokens.ts` → returns `GoogleConnectionStatus`.

**Connect flow:**
1. User clicks "Connect Calendar"
2. `nova().connectionsConnect({ service: "calendar" })`
3. Main process: build OAuth URL via `electron/google/oauth.ts buildAuthUrl(service, redirectUri: "nova://connections-callback")` → call `shell.openExternal(url)`
4. User completes consent in browser → browser redirects to `nova://connections-callback?code=...&state=...`
5. `open-url` handler in `main.ts` detects `nova://connections-callback` → exchanges code → stores tokens via `electron/google/db-tokens.ts saveTokens(...)` → sends `IpcChannel.ConnectionsCallback` to renderer → renderer refreshes status

**Disconnect flow:**
1. User clicks "Disconnect"
2. `nova().connectionsDisconnect({ service })` → main deletes row from `google_oauth_tokens` → returns updated status

**YouTube "Refresh taste profile":**
- Calls `nova().youtubeRefreshTaste()` → main calls `electron/google/youtube.ts refreshTasteProfile(userId)` → updates `youtube_taste` table

**OAuth redirect URI:**
The `nova://` protocol is already registered in `main.ts` for auth callbacks. Add a second handler branch: if the URL matches `nova://connections-callback`, route to the connections token exchange rather than the auth callback.

`electron/google/config.ts` `getRedirectUriForService` must be updated to return `nova://connections-callback` for all three services (calendar, gmail, youtube) when running in Electron (i.e., always — the Mac app never runs a local HTTP server). The `GOOGLE_REDIRECT_URI` env var overrides are removed; the redirect URI is always the deep-link form.

**Google Cloud Console setup (user action required before Connections works):**
Add `nova://connections-callback` as an authorized redirect URI in the Google OAuth app at console.cloud.google.com. This is a one-time manual step documented in the plan.

---

## Google OAuth token exchange in main process

`electron/google/oauth.ts` already has `buildAuthUrl`. Add `exchangeCode(code, redirectUri, service)`:

```typescript
export async function exchangeCode(
  code: string,
  redirectUri: string,
  service: "calendar" | "gmail" | "youtube",
): Promise<void> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  const userId = await getUserId();
  await saveTokens(userId, service, tokens);
}
```

`saveTokens` already exists in `electron/google/db-tokens.ts` (ported in Plan 3).

---

## IPC additions summary

New entries in `shared/types.ts` `IpcChannel` enum:
```typescript
GetWindowMode = "window:get-mode",  // → "orb" | "app"
AppOpen = "app:open",
AppClose = "app:close",
PrefsGet = "prefs:get",
PrefsSet = "prefs:set",
PrefsChanged = "prefs:changed",          // push: main → renderer
ConnectionsStatus = "connections:status",
ConnectionsConnect = "connections:connect",
ConnectionsDisconnect = "connections:disconnect",
ConnectionsCallback = "connections:callback",  // push: main → renderer
YoutubeRefreshTaste = "youtube:refresh-taste",
RemindersGet = "reminders:get",
RemindersDone = "reminders:done",
RemindersDelete = "reminders:delete",
MemorySearch = "memory:search",
MemoryPin = "memory:pin",
MemoryArchive = "memory:archive",
MemoryDelete = "memory:delete",
```

All request/response channels use `ipcMain.handle`. Push channels (`PrefsChanged`, `ConnectionsCallback`) use `webContents.send`.

---

## Key constraints

1. **API keys stay in main process** — no env vars cross to renderer via IPC
2. **Never `select("embedding")`** on `memories` table
3. **`nova://` deep-link** is used for both auth callbacks AND connections callbacks — disambiguate by path (`nova://auth-callback` vs `nova://connections-callback`)
4. **Orb window hides (not closes) when app window opens** — `win.hide()` / `win.show()`, not `win.close()`
5. **Tailwind only in renderer** — main/preload bundles unchanged
6. **Prefs changes from Settings tab propagate to orb** — main broadcasts `PrefsChanged` to both windows after save
7. **Google OAuth PKCE**: `electron/google/oauth.ts` must use `code_challenge` / `code_verifier` for the native app flow (Google requires PKCE for installed apps). Store `code_verifier` in a module-level Map keyed by `state` param for the duration of the OAuth flow.
8. **Single `open-url` handler** in `main.ts` — route `nova://auth-callback` to auth, `nova://connections-callback` to connections token exchange
9. **`electron/google/oauth.ts` redirect URI** for connections: `nova://connections-callback` (not the web app's `/api/google/*/connect` routes)
