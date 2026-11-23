# Dump

A one-page notes app for dumping thoughts, shopping lists and anything else, quickly. It works on iPhone and laptop, keeps working offline, and keeps every device in sync with end-to-end encryption.

- **Main product: the web app.** It's a single self-contained file, [`web/index.html`](web/index.html): no build step, no frameworks, no dependencies. It's hosted on Cloudflare together with its sync API.
- **There's also a native iOS app** (SwiftUI + widget + App Intents) in `Dump/`, `DumpWidget/` and `Shared/`. It was generated with XcodeGen from `project.yml` but has **never been compiled**: Xcode wasn't installed on the machine it was written on, and it was only type-checked against the Mac Catalyst SDK. It does **not** sync. Those folders are git-ignored and are not in the GitHub repo.

Other docs: [DEPLOY.md](DEPLOY.md) (step-by-step deployment), [CLAUDE.md](CLAUDE.md) (context and invariants for coding agents), [AGENTS.md](AGENTS.md) (pointer for other agents).

---

## Features

**Writing**
- One page of lines. Return starts a new line and continues the current list. Return on an empty list item ends the list.
- Backspace at the start of a line removes its point first, then joins the line to the one above.
- Pasting several lines creates one line each.

**Formatting** (per line, not per character)
- **Text colour:** 7 rainbow colours plus "ink", which is black in light mode and white in dark mode. Each colour has its own hue, saturation and brightness for light and for dark mode, so it stays readable on both.
- **Bold only.** Italic and underline were removed on purpose.
- **Points:**
  - Dots.
  - Numbers. The value is editable: tap the number to set any value, and Return continues counting with n+1.
  - Round or square tick boxes, whose ticked state is drawn as a **solid fill, tick, cross or dot**.
- **Line breaks:** a full-width divider line.

**Layout** (sized for iPhone 16 Pro, 402 pt wide, in a Liquid Glass style)
- **Top:** a persistent colour bar. In select mode it collapses into a small grey circle tinted with the selected line's colour, and tapping the circle reopens it.
- **Bottom left:** Select text and Bold. **Bottom right:** line break and the point-style menu. A hide-keyboard button appears while typing.
- **Left edge:** tiny line numbers. Tap one to select that line, tap more to add lines, or shift-click to select a range on a laptop.

**Select mode**
- **Top bar:** ← → (tap to move the caret, long-press to open the **trackpad**), Copy, Select all, Done.
- **Bottom:** a glass menu with 20 actions: Bold, Plain, Dots, Numbers, Set #, Round box, Square box, Tick style, Tick/untick, Renumber, Line break, Line above, Line below, Move up, Move down, Duplicate, Paste below, Copy, History, Delete.
- **Trackpad:** drag to place the start point, lift your finger, then drag again to select up to the end. Within one line this selects characters. Dragging across lines selects whole lines.
- Tap text in select mode to place the caret.

**Edit history** (works like git)
- Typing bursts are grouped into snapshots (2.5 s idle; 0.7 s after structural changes). Each entry has a label and +added / −removed / ~changed counts.
- Preview any version, then restore it. A restore adds a new entry, so nothing is lost.
- Export a backup to `.json`, import it on another device, or copy all as plain text.

**Laptop**
- Centred column layout with hover states.
- Keyboard shortcuts:

  | Shortcut | Action |
  |---|---|
  | ⌘/Ctrl B | bold |
  | ⌘/Ctrl ⇧ ↑ / ↓ | move line |
  | ⌘/Ctrl Enter | tick / untick |
  | ⌘/Ctrl ⇧ − | line break |
  | ⌘/Ctrl ⇧ L | select line |
  | ⌘/Ctrl ⇧ H | history |
  | Esc | done |

- In select mode: ← → move the caret, ⇧ ← → select, ↑ ↓ change line, ⌘/Ctrl C copy, ⌘/Ctrl A select all, ⌫ delete.

**Offline**
- A service worker keeps a copy of the app. Every edit is saved locally first.
- The app can be added to the iPhone Home Screen or installed as a desktop app.

**Sync**
- End-to-end encrypted with your passphrase. The server only ever stores ciphertext.
- Offline edits from several devices are merged line by line on reconnect, and typed text is never dropped.
- On first launch, the app offers sync and asks only for the passphrase.

**Live updates**
- While the app is open, each device keeps a WebSocket open to the sync server. A save on one device makes the others fetch the change within about a second.

**Notifications: not built** (deliberately off). See the [roadmap](#roadmap).

---

## Architecture

```
 iPhone (Safari / Home Screen app)        Laptop (any browser / installed app)
 ┌──────────────────────────────┐        ┌──────────────────────────────┐
 │ web/index.html               │        │ web/index.html               │
 │  · notes in localStorage     │        │  · notes in localStorage     │
 │  · AES-GCM encrypt/decrypt   │        │  · AES-GCM encrypt/decrypt   │
 │  · web/sw.js offline cache   │        │  · web/sw.js offline cache   │
 └──────────────┬───────────────┘        └───────────────┬──────────────┘
      HTTPS GET/PUT /v1/note  +  WebSocket /v1/live (ciphertext only)
                └────────────────────┬────────────────────┘
                     ┌───────────────▼────────────────┐
                     │ Cloudflare Worker "notes"      │  sync-worker/worker.js
                     │  · /v1/*  → sync API           │  config: wrangler.jsonc
                     │  · else   → ASSETS (./web)     │
                     └───────────────┬────────────────┘
                     ┌───────────────▼────────────────┐
                     │ Durable Object  NoteBox        │  binding NOTES
                     │  one per sync space (SQLite)   │  strongly consistent
                     │  stores {rev, data, updated}   │
                     │  holds live WebSockets         │
                     └───────────────┬────────────────┘
                                     │ read once, for migration only
                     ┌───────────────▼────────────────┐
                     │ KV namespace (legacy)          │  binding DUMP
                     └────────────────────────────────┘
```

One Worker serves both the app and the API from the same origin. That's why each device only needs the passphrase: the app finds the API on its own address through `/v1/health`.

---

## Sync protocol

### Keys
```
passphrase ──NFKC──▶ PBKDF2-SHA256, 310,000 iterations, salt "dump-sync-v1", 512 bits
   bits[0..256)   → AES-GCM-256 key            (never leaves the device)
   bits[256..512) → 64-hex sync-space id       (sent as header X-Dump-Id)
```
The same passphrase on every device gives the same sync space and the same key. A different passphrase is a separate, empty sync space.

### Payload
`"v1." + base64(12-byte IV) + "." + base64(AES-GCM ciphertext)`, where the plaintext is JSON `{ "lines": [...], "modified": <ms> }`.

### Endpoints (`sync-worker/worker.js`)
| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/v1/health` | none | `{ ok, app: "dump-sync", v, live }` |
| GET | `/v1/note` | header `X-Dump-Id` | `{ rev, data, updated }`, or **404** if the sync space is empty |
| PUT | `/v1/note` | header `X-Dump-Id`, body `{ baseRev, data }` | `{ rev, updated }`, or **409** `{ error:"conflict", rev, data }` if `baseRev` isn't the latest |
| GET (Upgrade) | `/v1/live` | WebSocket. Subprotocols: `"dump-v1"` plus the sync-space id | Server pushes `{"type":"changed","rev":N}` after every successful PUT |

CORS is open (`*`), because the API only ever sees ciphertext and unguessable ids. `rev` starts at 0 (empty) and increments by exactly 1 per accepted write. The Durable Object processes requests for one sync space one at a time, so two writes can never both win the same `rev`.

### Live updates
- The client opens `wss://<origin>/v1/live` with protocols `["dump-v1", <id>]`. The Worker routes it to that sync space's NoteBox, which accepts it with the hibernation API.
- After every successful PUT, the DO broadcasts `{"type":"changed","rev":N}` to that space's sockets. A client receiving a newer `rev` simply runs a normal sync.
- **Keep-alive:** the client sends `"ping"` every 30 s, and the DO auto-answers `"pong"` without waking (`setWebSocketAutoResponse`).
- **Reconnect** uses exponential backoff up to 30 s, and also happens on `visibilitychange` (visible) and `online`.
- **Polling fallback:** every 30 s while live isn't connected, every 5 min while it is.

### Client algorithm (`syncNow` in `web/index.html`)
1. Flush pending local saves, then `GET /v1/note`. A 404 resets the local `rev` to 0.
2. If the remote copy exists and (its `rev` ≠ the local `rev` **or** its decrypted lines ≠ the local `base`):
   - local unchanged since `base` → adopt remote;
   - otherwise → `merge3(base, local, remote)`.
   Then set `base = remote`, `rev = remote.rev`.
3. If local now equals `base`, stop. Otherwise `PUT { baseRev: rev, data: encrypt(lines) }`.
   - 200 → `base = what was sent`, `rev = new rev`.
   - 409 → loop back to step 1 (at most 4 attempts).

Sync triggers:
- shortly after an edit: 1.2 s after typing stops, or 0.5 s after a structural change such as a new line, a tick or a colour;
- when the app opens, becomes visible or comes back online;
- a live "changed" push;
- the polling fallback;
- "Sync now" in the sheet.

Sync state is kept in `localStorage["dump.sync.v1"]` = `{ url, id, key (base64 raw AES key), rev, base (lines), last, err, live }`. `live` mirrors `/v1/health`, and the client only opens a WebSocket when it isn't `false`.

Measured locally: a new line typed on one device appeared on another in about 0.6 s.

The content comparison in step 2 is a **self-heal**. Devices whose `rev` numbers matched but whose contents had drifted (because of the KV bug below) converge on their next sync.

### Merge rules (`merge3(base, local, remote)`)
Merging works per line, matched by line `id`:

| Situation | Result |
|---|---|
| Changed on one side only | That side's version wins |
| Added on either side | Kept. A local addition goes right after the line it followed locally. |
| Deleted on one side and untouched on the other | Stays deleted |
| Edited on one side, deleted on the other | **The edit is kept** |
| Both sides edited the text differently | **Both are kept**: remote first, then the local copy with a new id |
| Both sides edited different fields (e.g. one ticked it, one made it bold) | Merged field by field |
| Line order | Follows the remote order. Local-only lines are inserted after their local predecessor. |

**First connect on a device:**
- If the device only has the starter note, it adopts the synced notes.
- Otherwise the user chooses **Merge both** (`merge3([], local, remote)`) or **Use synced notes**. Either way, the previous local version stays in Edit History.

`window.DumpDebug.merge3` is exposed for quick checks in the console.

### Why Durable Objects, not KV
The first version stored notes in Workers KV. KV reads can be up to about 60 s stale across Cloudflare locations, and a phone on mobile data and a laptop on Wi-Fi usually reach different locations. Both devices would read the same old `rev`, both writes were accepted as `rev+1`, and from then on each device believed it was up to date and never pulled the other's changes.

Moving each sync space into one strongly consistent Durable Object fixed this. The old KV binding `DUMP` is kept only so data already in KV is copied into the DO on first read.

---

## Data model

```js
// One line
{
  id: "uuid",
  text: "Milk",
  kind: "plain" | "bullet" | "check" | "number" | "divider",
  shape: "circle" | "square",           // for check
  mark: "fill" | "tick" | "cross" | "dot", // how a ticked box is drawn
  checked: false,
  n: 1,                                 // for number (any integer, user-editable)
  bold: false,
  color: "ink" | "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "violet"
}
```

| localStorage key | Contents |
|---|---|
| `dump.note.v1` | `{ lines, modified }`: the note itself |
| `dump.history.v1` | Up to 200 snapshots: `{ id, date, label, lines, added, removed, changed, preview }`. If the quota is hit, the oldest are trimmed. |
| `dump.sync.v1` | Sync state (see above). Absent means sync is off. |
| `dump.syncOffered` | `"1"` once the first-launch sync sheet has been shown on this device |

---

## Offline and updates (`web/sw.js`)
- **Network-first** with a 3 s timeout, falling back to the cached copy. When online, devices pick up a new release on the next load.
- The cache is named after `VERSION`. **Bump `VERSION` on every web release** so old caches get cleaned up.
- **Never touches `/v1/*`**, so sync data always comes fresh from the server.
- Only registers on `https:` or `localhost`.

---

## Repository layout

| Path | What it is |
|---|---|
| `web/index.html` | The whole web app: HTML, CSS and JS in one file |
| `web/dump.html` | A byte-identical copy of `index.html`, kept for old links. Keep it in sync with `cp`. |
| `web/sw.js` | Service worker (offline cache) |
| `web/manifest.webmanifest`, `web/icon-*.png` | Home Screen / install metadata and icons |
| `sync-worker/worker.js` | Cloudflare Worker: sync API, live WebSocket, the `NoteBox` Durable Object, and the static-asset passthrough |
| `sync-worker/wrangler.toml` | **Legacy** config for deploying the sync Worker on its own with KV (`scripts/setup-sync.sh`) |
| `wrangler.jsonc` | **Main** Cloudflare config: Worker `notes`, assets `./web`, DO `NOTES` → `NoteBox` (migration tag `v1`), legacy KV `DUMP` |
| `scripts/` | Netlify-era deploy scripts (`deploy-all.sh`, `deploy-web.sh`, `setup-sync.sh`). Not needed for the Cloudflare-from-GitHub flow. |
| `DEPLOY.md` | Step-by-step deployment and device setup |
| `CLAUDE.md`, `AGENTS.md` | Context for coding agents |
| `Dump/`, `DumpWidget/`, `Shared/`, `project.yml`, `Dump.xcodeproj/` | Native iOS app (local only, **git-ignored, not in the repo**) |

---

## Deploying

The full step-by-step guide is in [DEPLOY.md](DEPLOY.md). In short:

1. In Cloudflare, go to **Workers & Pages → Create → Import a repository** and pick this repo.
2. Use these build settings:
   - **Project name:** `notes`. It must equal `"name"` in `wrangler.jsonc`.
   - **Build command:** empty.
   - **Deploy command:** `npx wrangler deploy`.
3. Storage (the Durable Object, plus KV for migration) is created automatically on deploy.
4. Every push to `main` redeploys.

**Devices:**
1. Open `https://notes.<your-subdomain>.workers.dev`. On iPhone, use Safari, then **Share → Add to Home Screen**.
2. Enter the **same passphrase** on every device.

---

## Local development and testing

Requires Node.js.

```bash
npx wrangler@4 dev --port 8787          # app + sync API + Durable Object, all local
```
```bash
npx wrangler@4 deploy --dry-run         # validate wrangler.jsonc without deploying
```

**Testing two devices on one machine:**
- Open `http://localhost:8787` and `http://127.0.0.1:8787`. They're different origins, so each has its own localStorage.
- Built-in sync detection only runs on `https:` or `localhost`. On the `127.0.0.1` tab, open the sync sheet and enter `http://127.0.0.1:8787` under **Use a different sync server**.
- To simulate going offline in a tab, temporarily override `window.fetch` so it rejects.

**Checks:**
- Merge: in the console, run `DumpDebug.merge3(base, local, remote)`.
- API: use `curl` with `-H "X-Dump-Id: <64 hex>"`, and check that a stale `baseRev` returns 409.
- After editing `web/index.html`, run `cp web/index.html web/dump.html` and bump `VERSION` in `web/sw.js`.

**Notes on the in-app preview browser:**
- It loads `file://` pages as `data:` URLs, where localStorage is disabled, so serve over HTTP to test.
- It doesn't run service workers, so offline mode can only be verified on a real device.

---

## Known limitations

- **Safari storage eviction:** Safari can clear website data for sites you haven't opened in a while. Keep Dump on the Home Screen, keep sync on, and export backups.
- **iPhone background:** iPhone pauses web apps in the background, so live updates stop while Dump is closed. It catches up immediately when reopened.
- **Forgotten passphrase:** the synced copy can't be decrypted by anyone. Each device still keeps its own notes.
- **Formatting is per line:** bold and colour apply to whole lines, not individual words.
- **Native iOS app:** no sync, and never compiled.
- **Testing gaps:** offline mode and live updates have been tested locally and in the browser, but not exhaustively on real devices.

## Roadmap

- **Notifications (off by design for now).** Web Push alerts when the other device changes something. Design notes:
  - Needs iOS 16.4+ and only works for the **Home Screen** app, not a Safari tab.
  - Needs VAPID keys, with push subscriptions stored in the NoteBox DO.
  - Payload-less "ping" only, never note content.
  - Alert only for changes from *another* device, rate-limited (for example, at most one every few minutes).
  - iOS can't sync in the background, so the alert just prompts you to open the app.
- Sync for the native iOS app (it could reuse the same protocol).
- Per-character formatting.
- Multiple notes/pages, if ever needed. The app is intentionally one page.
