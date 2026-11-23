# CLAUDE.md: context for coding agents

Read [README.md](README.md) for the full architecture, sync protocol and data model. This file covers what you need in order to work safely on the project.

## What this is
Dump is a one-page "dump everything" notes app for iPhone and laptop: thoughts, shopping lists, quick notes.
- **The product is the web app:** `web/index.html`, one self-contained file with no build step and no dependencies.
- **Hosting:** one Cloudflare Worker named `notes` (`wrangler.jsonc`, code in `sync-worker/worker.js`). It serves `./web` as static assets plus the end-to-end-encrypted sync API at `/v1/*`.
- **Storage:** one Durable Object (`NoteBox`, binding `NOTES`) per sync space. It also holds the live-update WebSockets.
- **Deploys:** every push to `main` redeploys through Cloudflare Workers Builds.
- **Native iOS app:** a SwiftUI app with widget and App Intents also exists locally (`Dump/`, `DumpWidget/`, `Shared/`, XcodeGen `project.yml`). It's git-ignored, has never been compiled (no Xcode on the original machine), and has no sync.

## The user's preferences
- **Not a developer.** Give step-by-step, plain-language instructions with exact button names. When they send a screenshot, tell them exactly what to click.
- **Look and feel:**
  - Sized for **iPhone 16 Pro** (402 pt wide), with a **Liquid Glass** look (translucent blurred bars, capsules).
  - Fast and simple, with text only. **Bold only**: italic and underline were removed on request.
  - Persistent colour bar at the top: 7 rainbow colours plus ink, tuned per light/dark mode.
  - Bottom bar: select + bold on the left, line break + point style on the right.
  - Tiny line numbers on the left enter select mode. Long-pressing the arrows opens the trackpad.
- **Devices:** it must work, and look the same, on phone and laptop, offline too, with notes consistent everywhere.
- **Workflow:**
  - Prefers automation, and parallel work where possible.
  - Pushes to GitHub over SSH. Pushes run from the user's own terminal session.
- **Notifications:** explicitly **off** for now. Live updates were requested instead.

## Hard invariants (don't break these)
1. **Never send plaintext notes off the device.** Everything that goes to `/v1/*` is AES-GCM ciphertext. The key is derived from the passphrase (PBKDF2-SHA256, 310k iterations, salt `dump-sync-v1`) and never leaves the device. Changing the KDF, its parameters or its salt orphans every existing sync space.
2. **`web/sw.js` must never cache or intercept `/v1/*`.** Stale sync data breaks convergence.
3. **Bump `VERSION` in `web/sw.js` on every change under `web/`.**
4. **Keep `web/dump.html` byte-identical to `web/index.html`:** run `cp web/index.html web/dump.html`.
5. **`wrangler.jsonc` `"name"` must stay `"notes"`.** It must match the Cloudflare project name, or Workers Builds fails.
6. **Durable Object migrations are append-only.** Never edit or remove the `v1` tag (`new_sqlite_classes: ["NoteBox"]`). Add `v2`, `v3`, … for changes.
7. **Don't remove the KV binding `DUMP`** while old data may still need migrating. `NoteBox.read()` copies KV data in on first read.
8. **Merging must never drop typed text.** If both devices edited a line differently, keep both. See `merge3`. Version numbers alone aren't trusted: `syncNow` also compares content, which is the self-heal.
9. **Rev semantics:** 0 means empty, and each accepted PUT increments by exactly 1. A stale `baseRev` gets 409 with the current `{rev, data}`.

## Where things are in `web/index.html`
CSS sections are marked `/* ---------- Name ---------- */`:
- Liquid Glass, Lines, Top bar, Bottom bar, Point menu
- Selection menu + trackpad
- Toast, dialogs, history
- Sync sheet
- Laptop / tablet (≥ 700 px media query)

JS sections are marked `/* ================= Name ================= */`, in order:
1. **Storage keys & helpers:** the `KEY` and `HKEY` constants, `$`, `uid`, `esc`, `clone`.
2. **Colours (tuned per light/dark):** HSB tables, then injected `--c-*` / `--m-*` CSS variables.
3. **Icons:** an inline SVG path table `P`, plus `cbSVG` for the tick boxes.
4. **Model:** `L()` line factory, `continuation`, `exportLine`, `plainText`, `starter`, `read`/`write` (localStorage), and the state object `S`.
5. **Lookup:** `idx`, `line`, `targets()`. `targets()` reads `document.activeElement` first.
6. **Rendering:** `makeRow`, `updateRow` (cached by key), `renderLines` (keyed reconcile; never moves the focused row needlessly), `fit` (auto-height), Chrome/`renderChrome`, the `TILES` array (the 20 select-menu actions).
7. **Saving + history:** `changed()` (render → save after 300 ms → history after 0.7/2.5 s → `scheduleSync` 0.5 s structural / 1.2 s typing), `commitHistory`, `flush`.
8. **Focus helpers:** `focusLine`, `ensureVisible`.
9. **Typing:**
   - `split` (Return), `pasteMulti`, `backspaceAtStart`.
   - Event delegation on `#lines`: Enter/Backspace on keydown; a newline arriving through `input` is also split.
10. **Formatting** and **Structure:** colour, bold, kinds, numbers, dividers, insert, move, duplicate, delete.
11. **Clipboard**, then **Toast**.
12. **Selection mode:** enter and exit, gutter toggling with shift-range, `tapStatic` (caret from tap via `caretRangeFromPoint`). Sub-section **Caret / trackpad** has `moveCaret`, the arrow long-press and the pad pointer events.
13. **Bars wiring**, **Number dialog**, **History sheet** (incl. export/import backup).
14. **Sync (end-to-end encrypted, works offline):** `deriveSecrets`, `seal`/`unseal`, `api`, `merge3`, `applyLines`, `setSync`, `syncNow`, `probeSync`, `connectSync`, `resolvePending`, the sync sheet UI, and the live-updates WebSocket client (`liveConnect` / `liveRetry` / `liveDisconnect`, defined right after `probeSync`).
15. **Keyboard shortcuts (laptop)**, **Keyboard-aware positioning (Safari)** (visualViewport → `--kb` / `--vvtop`), **Start**, **Offline** (service worker registration).

## Testing
- **Local run:** `npx wrangler@4 dev --port 8787` runs the app, the API and the Durable Object.
- **Two devices:** use `http://localhost:8787` and `http://127.0.0.1:8787`, which have separate localStorage. On the second, enter the server URL under "Use a different sync server", because built-in detection only runs on https/localhost.
- **Config check:** `npx wrangler@4 deploy --dry-run` validates `wrangler.jsonc`.
- **Merge checks:** `window.DumpDebug.merge3(base, local, remote)` in the console.
- **API checks:** use `curl` with `-H "X-Dump-Id: <64 hex>"` and confirm that a stale `baseRev` returns 409.
- **Offline simulation:** in a tab, override `window.fetch` to reject, edit, then restore it and dispatch `online`.
- **Before shipping web changes:** `cp` index → dump, bump `VERSION`, and do one manual pass at 402×874 and at laptop width.

## Deploying
- Commit, then push to `main` (`git push`, over SSH). Cloudflare rebuilds automatically.
  - Build command: empty. Deploy command: `npx wrangler deploy`. Root: `/`.
- Then check **Workers & Pages → notes → Deployments** shows the new build as Ready.
- Commit messages end with this line:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Gotchas we already hit
- **KV is eventually consistent.** Reads can be about 60 s stale across locations, so two devices both wrote the same `rev` and never converged. The fix was the Durable Object plus the content comparison in `syncNow`. Don't move sync storage back to KV.
- **Chrome defers focus events while the window is unfocused** (for example in automation). That's why `targets()` checks `document.activeElement` before `S.focusedId`.
- **Render cache vs the live textarea:** `updateRow` skips rows whose cache key hasn't changed, but a textarea can still hold text the model doesn't (a split-off line break). The early return re-syncs `ta.value`.
- **In-app preview browser:**
  - It opens `file://` as a `data:` URL, where localStorage throws, so test over HTTP.
  - It doesn't run service workers.
- **Moving a focused element in the DOM blurs it.** `renderLines` removes stale rows before re-ordering, so the focused textarea isn't moved.
- **iOS keyboard:** buttons use `mousedown` `preventDefault` so taps don't steal focus and close the keyboard. Fixed bars follow `visualViewport` for the keyboard height.
- **Disk space:** the original Mac's disk was nearly full, so Node and `npx` downloads failed intermittently. Check `df -h` if installs fail.
- **Pushing:** don't push to GitHub from an agent shell without credentials. The user pushes over SSH from their own terminal.
