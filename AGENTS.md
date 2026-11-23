# AGENTS.md

**For coding agents** (Codex, Cursor, Copilot, Claude and others): the canonical project context is [CLAUDE.md](CLAUDE.md). It covers the user's preferences, where everything lives in `web/index.html`, how to test and deploy, and the bugs we've already hit. [README.md](README.md) has the full architecture, sync protocol and data model. Read both before making changes.

## The most important invariants
1. **Never send plaintext notes off the device.** Everything sent to `/v1/*` is AES-GCM ciphertext, keyed from the passphrase. Don't change the KDF, its parameters or its salt `dump-sync-v1`.
2. **`web/sw.js` must never cache or intercept `/v1/*`.**
3. **For every change under `web/`:**
   - bump `VERSION` in `web/sw.js`;
   - run `cp web/index.html web/dump.html` so the two stay byte-identical.
4. **Keep the name and storage config:**
   - `wrangler.jsonc` `"name"` stays `"notes"`, to match the Cloudflare project;
   - Durable Object migrations are append-only, so never edit the `v1` tag;
   - keep the `DUMP` KV binding while it's still needed for migration.
5. **Merging must never drop typed text.** Conflicting line edits keep both versions.
6. **Deploy by pushing to `main`.** Cloudflare Workers Builds redeploys automatically. Validate first with `npx wrangler@4 deploy --dry-run` and test locally with `npx wrangler@4 dev --port 8787`.
