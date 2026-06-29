# Nova — native macOS helper

A lightweight Electron app that provides an always-on-top orb, tray icon, hotkey (`Cmd+Shift+Space`), magic-link auth via Supabase, and a sync layer for conversations and memories.

## Development

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

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
