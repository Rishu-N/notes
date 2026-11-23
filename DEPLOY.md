# Deploying Dump (phone + laptop, works offline, stays in sync)

This guide puts Dump online so you can use it on your iPhone and your laptop. It keeps working offline, picks up app updates by itself, and keeps your notes the same on every device.

## How it fits together

| Piece | Where it lives | What it does |
|---|---|---|
| **The app** (`web/`) | Cloudflare (free) | The page you open in Safari or Chrome. Once you've opened it, it also works offline. |
| **Sync** (`sync-worker/worker.js`) | Same Cloudflare Worker, same address | Stores one **encrypted** copy of your notes, and tells your other open devices the moment something changes |
| **Your notes** | Each device | Saved on the device first, and encrypted with your passphrase **before** they're sent. Cloudflare only ever sees scrambled data. |

Everything is one Cloudflare Worker called `notes`, deployed straight from this GitHub repo. There's no separate server to set up and no storage to create by hand.

---

## 1. Connect the repo to Cloudflare (one time, about 5 minutes)

1. Sign up for free at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Import a repository**. Connect GitHub if it asks, then pick this repo.
3. On **Set up your application**, use these settings:

   | Field | Value |
   |---|---|
   | Project name | `notes`. It must match `"name"` in `wrangler.jsonc`. |
   | Build command | *(leave empty)* |
   | Deploy command | `npx wrangler deploy` |
   | Preview command | `npx wrangler preview` (the default is fine) |
   | Enable Preview builds | Optional. Switching it off is fine. |
   | Protect with Cloudflare Access | **Off**. If it's on, a login page blocks the app. |
   | Advanced settings → Root directory | `/` |

4. Click **Deploy**. On the first deploy, Cloudflare creates the storage automatically: one Durable Object per sync space, plus a KV namespace that's only used to migrate old data.
5. When it shows **Ready**, open **Overview** or **Domains** to find your address, which looks like `https://notes.<your-subdomain>.workers.dev`. Click **Visit** to open it.
   - No `workers.dev` address showing? Go to **Settings → Domains & Routes** and enable **workers.dev**.

## 2. Set up each device

Use **the same passphrase on every device**. A different passphrase creates a separate, empty set of notes.

**iPhone**
1. Open your `…workers.dev` address in **Safari**.
2. Tap **Share → Add to Home Screen → Add**. From now on, open Dump from that icon.
3. The first time, a **Sync** sheet appears. Type your passphrase and tap **Turn on sync**. If it doesn't appear, tap the **cloud** icon at the top right.

**Laptop**
1. Open the same address in any browser.
2. Optional, to get it as its own app:
   - Chrome or Edge: use **Install app** in the address bar.
   - Safari on Mac: **File → Add to Dock**.
3. Enter the same passphrase in the Sync sheet.

**When you connect a device that already has its own notes**, Dump asks you to **Merge both** or **Use synced notes**. Either way, that device's previous version stays in Edit History.

**Choosing a passphrase:** four random words is ideal. If you forget it, nobody can unlock the synced copy, including you. Each device still keeps its own notes.

## 3. How it behaves

- **Saving:** every edit is saved on the device straight away, then synced about a second after you stop typing. Other open devices get the change almost instantly over a live connection.
- **Live updates:** while Dump is open on two devices, a change on one appears on the other within about a second. When you reopen the app, it catches up at once.
- **Offline:** you can keep editing. Changes sync when you're back online. If the same line was edited differently on two devices, **both versions are kept**, so nothing you typed is lost.
- **App updates:** devices load the newest version whenever they're online.
- **Notifications** (alerts when the app is closed) are **not built**. They're turned off on purpose for now.

### The cloud icon
| Icon | Meaning |
|---|---|
| Cloud with ✓ (green) | Synced |
| Cloud with ↓ (orange, pulsing) | Syncing |
| Cloud with a slash (grey) | Offline. Edits are saved on the device and will sync later. |
| Cloud with ! (red) | Something went wrong. Tap it to see the reason. |
| Cloud with + (grey) | Sync isn't turned on for this device |

## 4. Updating the app

1. Make your changes.
2. For any change under `web/`:
   - bump `VERSION` in `web/sw.js`;
   - copy `web/index.html` over `web/dump.html` (`cp web/index.html web/dump.html`).
3. Commit and push:
   ```bash
   git add -A && git commit -m "Update Dump" && git push
   ```
4. Cloudflare redeploys automatically. Check **Workers & Pages → notes → Deployments** for the green **Ready**.
5. Fully close Dump on your devices and reopen it. On iPhone, swipe it away in the app switcher.

Updating never touches your notes.

## 5. Backups

To make one, select any line, open **History**, and tap **Export backup** to save a `.json` file. **Import backup** restores it on any device.

Do this now and then. Safari can clear data for sites you haven't opened in a while, and a backup also covers you if you forget your passphrase. Keeping Dump on your Home Screen also helps prevent the clearing.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Build failed | Open the failed deployment and read the log. The project name must be `notes`, the build command empty, and the deploy command `npx wrangler deploy`. |
| Devices show different notes | Tap the cloud on each device. Both must say **Synced** and use exactly the same passphrase (capitals and spaces count). Fully close and reopen both after a deploy. |
| Red cloud | Tap it to see the reason. Open `https://notes.<your-subdomain>.workers.dev/v1/health`. It should show `"app":"dump-sync"`. |
| Sync sheet asks for a server address | The page isn't being served by the `notes` Worker, or you're on a non-https address. Open the `…workers.dev` address. |
| "Sync needs the https:// address" | Open the app from its `https://` address, not from a file. |
| Still seeing the old version | Close Dump completely and reopen it, twice if needed. Check the latest deployment is **Ready**. |
| Notes gone in Safari | Safari cleared site data. If sync was on, enter your passphrase again to get your notes back. Otherwise import a backup. |

## 7. Limits (free plans)

- **Cloudflare Workers:** 100,000 requests a day. Durable Objects and live updates are on the free plan.
- **Saves:** Dump groups your typing into one save about a second after you stop, so normal use stays far below the limits.
- **Native iOS app:** the Xcode project doesn't sync, and isn't part of this deploy.

---

## Alternative / legacy setup (not needed any more)

Before the single-Worker setup, the app and the sync server were deployed separately. Use this only if you specifically want the app hosted somewhere else.

- **App on Netlify:**
  - Drag the `web` folder onto **app.netlify.com/drop** (sign up first, or it's deleted after about an hour).
  - Or run `scripts/deploy-web.sh` after `npx netlify-cli login`. `scripts/deploy-web.sh --zip` makes a drag-and-drop zip instead.
- **Standalone sync Worker:**
  1. In Cloudflare, create a KV namespace `dump` and a Worker `dump-sync`.
  2. Paste in `sync-worker/worker.js` and add a KV binding named `DUMP`. Without a Durable Object binding, the Worker falls back to KV.
  3. Or run `scripts/setup-sync.sh`, which uses `sync-worker/wrangler.toml`, after `npx wrangler@3 login`.
  4. In the app's Sync sheet, open **Use a different sync server** and paste that Worker's address.
- **Both at once:** `scripts/deploy-all.sh` runs both scripts in parallel, with logs in `scripts/logs/`.

**Note:** KV can serve reads up to about a minute old across locations. That's why the main setup uses a Durable Object instead, so prefer the main setup.
