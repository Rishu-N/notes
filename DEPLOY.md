# Putting Dump online (phone + laptop, works offline, syncs)

This guide gets Dump running on your iPhone and your laptop. It keeps working offline, and once a device is back online it updates itself and syncs your notes.

> **Simplest setup (recommended): one Cloudflare Worker does everything.**
> Connect this GitHub repo in **Cloudflare → Workers & Pages → Create → Import a repository**, and keep the defaults. The repo's `wrangler.jsonc` serves the app from `web/` and the encrypted sync API from `sync-worker/worker.js` at the same address. It also creates the storage automatically. Every push to `main` redeploys.
> Then open the app's `…workers.dev` address on each device. The first time, it offers sync and asks only for your passphrase. Use the same passphrase everywhere, and every device shows the same notes.
> The rest of this guide covers the older two-piece setup: Netlify, plus a separate sync Worker you paste in by hand.

## What you're setting up

| Piece | Where it lives | What it does |
|---|---|---|
| **The app** (`web/` folder) | Netlify (free) | The page you open in Safari or Chrome. Once you've opened it, it also works offline. |
| **The sync server** (`sync-worker/worker.js`) | Cloudflare (free) | Stores one **encrypted** copy of your notes so every device can share it. |
| **Your notes** | Each device's browser | Saved on the device first. Encrypted with your passphrase **before** they're sent anywhere. Cloudflare and Netlify only ever see scrambled data. |

You can do this in one of two ways:
- **Option A**: click through the Cloudflare and Netlify websites. Nothing to install.
- **Option B**: run one script that does both at once. You need Node.js installed and have to log in once to each service.

> **Your Mac's disk is nearly full.** Option B needs Node.js plus a few hundred MB for the tools it downloads. If space is tight, use Option A.

---

## Option A: by hand, in the browser (about 10 minutes)

### 1. Create the sync server on Cloudflare
1. Sign up for free at **dash.cloudflare.com**.
2. Go to **Storage & Databases → KV → Create** and name the namespace `dump`.
3. Go to **Workers & Pages → Create → Worker**, name it `dump-sync`, and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste in the whole contents of `sync-worker/worker.js`, and click **Deploy**.
5. In the worker, open **Settings → Bindings → Add → KV namespace**. Set the variable name to `DUMP` (in capitals) and choose the namespace `dump`. Click **Deploy**.
6. Copy the worker's address. It looks like `https://dump-sync.<your-name>.workers.dev`.
   Open it in a browser. You should see `{"ok":true,"app":"dump-sync","v":1}`.

### 2. Put the app on Netlify
1. Sign up for free at **app.netlify.com** first. Sites dropped without an account are deleted after about an hour.
2. Go to **app.netlify.com/drop** and drag the whole **`web`** folder onto the page.
3. You'll get an address like `https://random-name-123.netlify.app`. You can rename it under **Site configuration**.

**Or host the app on Cloudflare from GitHub, instead of Netlify:**
1. In Cloudflare, go to **Workers & Pages → Create → Import a repository** and pick `Rishu-N/notes`.
2. Keep the defaults. The build command can be empty and the deploy command is `npx wrangler deploy`. The repo's `wrangler.jsonc` tells Cloudflare to serve the `web` folder.
3. You'll get an address like `https://notes.<your-name>.workers.dev`. Every push to `main` redeploys it automatically.

Then go to [Connect your devices](#connect-your-devices).

---

## Option B: automated (both deploys at the same time)

1. Install Node.js (LTS) from **nodejs.org**, or run `brew install node`.
2. Log in to each service once (each one opens a browser window):
   ```bash
   npx wrangler@3 login
   ```
   ```bash
   npx netlify-cli login
   ```
3. From the project folder, run:
   ```bash
   cd "/Users/rishunand/Desktop/CLaude/iphone apps/notes" && scripts/deploy-all.sh
   ```
   This runs two scripts in parallel and saves a log for each in `scripts/logs/`:
   - `scripts/setup-sync.sh` creates the `dump` KV namespace the first time, deploys the worker, then checks the worker is live and prints its address.
   - `scripts/deploy-web.sh` bumps the app's offline version and deploys `web/` to Netlify. The first time, Netlify asks whether to create a new site. To use a site you already made with Option A, run `npx netlify-cli link` first.

You can also run each script on its own. To skip the Netlify login and just make a zip for drag-and-drop, run:
```bash
scripts/deploy-web.sh --zip
```

---

## Connect your devices

Use **the same sync server address and the same passphrase** on every device.

**iPhone**
1. Open your Netlify address in **Safari**.
2. Tap **Share → Add to Home Screen**. From now on, open Dump from that icon.
3. Tap the **cloud** icon at the top right.
4. Paste the sync server address, type your passphrase, and tap **Connect**.

**Laptop**
1. Open the same Netlify address in any browser.
2. Optional, to get it as its own app:
   - Chrome or Edge: **Install app** (the icon in the address bar).
   - Safari on a Mac: **File → Add to Dock**.
3. Click the **cloud** icon and enter the same address and passphrase.

The first time a device connects:
- **If it only has the sample note**, it simply takes the synced notes.
- **If it already has its own notes**, you'll be asked to **Merge both** or **Use synced notes**. Either way, the device's previous version stays in Edit History.

**Choosing a passphrase:** four random words is ideal. If you forget it, the synced copy can't be unlocked by anyone, including you. Each device still keeps its own notes, though.

### The cloud icon
| Icon | Meaning |
|---|---|
| Cloud with ✓ (green) | Synced |
| Cloud with ↓ (orange, pulsing) | Syncing |
| Cloud with a slash (grey) | Offline. Edits are saved on the device and will sync later. |
| Cloud with ! (red) | Something went wrong. Tap it to see the reason. |
| Cloud with + (grey) | Sync isn't set up on this device |

---

## How offline and auto-updating work

- **The app:** a small offline helper (`web/sw.js`) keeps a copy of the app on each device. When you're online, it always loads the newest version first. When you're offline, it uses the saved copy.
- **Your notes:** every edit is saved on the device straight away. A few seconds after you stop typing, Dump syncs. It also syncs when you reopen the app, when the internet comes back, and every 30 seconds while the app is open.
- **Offline edits on two devices:** they're merged line by line when the devices reconnect.
  - A line changed on only one device keeps that change.
  - Lines added on either device are kept.
  - If the **same line** was edited differently on both, **both versions are kept** next to each other, so nothing you typed is lost.

## Updating the app later

- **Option A:** in Netlify, open your site, go to **Deploys**, and drag the `web` folder on again.
  First, open `web/sw.js` and change `const VERSION = '…'` to something new (for example `dump-v2`). That's what tells every device to fetch the update.
- **Option B:** run `scripts/deploy-web.sh`. It bumps the version for you.

Updating never touches your notes. If a device still shows the old version, close and reopen Dump. It sometimes takes two launches.

## Backups

Open **History** (select a line → History), then tap **Export backup** to save a `.json` file. **Import backup** restores it on any device.

Do this now and then. Safari can clear storage for sites you don't open for a while (keeping Dump on your Home Screen helps), and a backup also covers you if you forget your passphrase.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Red cloud | Tap it to see the reason. Then check the worker address in a browser (it should show `"app":"dump-sync"`) and that the KV binding is named exactly `DUMP`. |
| "No Dump sync server at that address" | The address is wrong, or the worker code wasn't saved and deployed. Paste the `…workers.dev` address with no extra path. |
| "KV binding DUMP is missing" | Worker → **Settings → Bindings** → add a KV namespace with the variable `DUMP` → Deploy. |
| Devices don't see each other's notes | They're using different passphrases, so they're in **different sync spaces**. Turn sync off on one device and reconnect it with the right passphrase. |
| "Sync needs the https:// address" | Open the app from its Netlify `https://` address, not from a file or a `http://` address. |
| Still seeing the old version after an update | Close Dump completely and reopen it, twice if needed. Check that `VERSION` in `web/sw.js` changed. |
| Notes vanished in Safari | Safari can clear website data you don't open for a while. Keep Dump on the Home Screen, export backups regularly, and if sync is on, reconnect to get your notes back. |
| `npx: command not found` | Install Node.js (see Option B), or use Option A. |

## Limits (free plans)

- **Cloudflare Workers + KV:** 100,000 requests and about 1,000 saves per day on the free plan. Dump groups your typing into one save a few seconds after you stop, so normal use stays well under this.
- **Edits on two devices within the same minute:** they're merged when the devices sync. In the rare case one is missed, every device keeps its own **Edit History**, so you can restore it from there.
- **Netlify:** the free plan is plenty for one person's app.
- **The native iOS app** (the Xcode project) doesn't use this sync yet. This guide covers the web app.
