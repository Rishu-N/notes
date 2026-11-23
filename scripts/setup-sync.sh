#!/usr/bin/env bash
# Deploys the encrypted sync server (Cloudflare Worker + KV) for Dump.
# You must be logged in first:  npx wrangler@3 login
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$ROOT/sync-worker"
TOML="$WORKER_DIR/wrangler.toml"
WRANGLER=(npx --yes wrangler@3)
PLACEHOLDER="REPLACE_WITH_KV_NAMESPACE_ID"

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "✗ Node.js is not installed. Install the LTS version from https://nodejs.org (or: brew install node), then run this again." >&2
  exit 1
fi

cd "$WORKER_DIR"

echo "→ Checking Cloudflare login…"
if ! WHO="$("${WRANGLER[@]}" whoami 2>&1)" || echo "$WHO" | grep -qi "not authenticated"; then
  echo "✗ You're not logged in to Cloudflare. Run this once, then try again:" >&2
  echo "    npx wrangler@3 login" >&2
  exit 1
fi
echo "✓ Logged in"

if grep -q "$PLACEHOLDER" "$TOML"; then
  echo "→ Creating KV namespace \"dump\"…"
  OUT="$("${WRANGLER[@]}" kv namespace create dump 2>&1)" || { echo "$OUT" >&2; exit 1; }
  echo "$OUT"
  # Output contains a line like:  id = "0123abcd…"   (or "id": "…")
  KV_ID="$(echo "$OUT" | grep -Eo '[0-9a-f]{32}' | head -n1 || true)"
  if [[ -z "$KV_ID" ]]; then
    echo "✗ Couldn't read the namespace id from the output above. Paste it into $TOML (id = \"…\") and rerun." >&2
    exit 1
  fi
  sed -i '' "s/$PLACEHOLDER/$KV_ID/" "$TOML"
  echo "✓ KV namespace id saved to wrangler.toml"
else
  echo "✓ KV namespace already configured"
fi

echo "→ Deploying worker…"
DEPLOY_OUT="$("${WRANGLER[@]}" deploy 2>&1)" || { echo "$DEPLOY_OUT" >&2; exit 1; }
echo "$DEPLOY_OUT"

URL="$(echo "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9._-]+\.workers\.dev' | head -n1 || true)"
if [[ -z "$URL" ]]; then
  echo "⚠ Deployed, but couldn't spot the workers.dev address above. Find it in the Cloudflare dashboard (Workers & Pages → dump-sync)."
  exit 0
fi

echo "→ Checking $URL …"
for _ in 1 2 3 4 5; do
  if curl -fsS "$URL/" 2>/dev/null | grep -q "dump-sync"; then
    echo ""
    echo "✓ Sync server is live:  $URL"
    echo "  Paste this address into Dump → cloud icon on every device."
    exit 0
  fi
  sleep 3
done
echo "⚠ Deployed to $URL but it didn't answer yet. Try opening it in a browser in a minute; it should show {\"ok\":true,\"app\":\"dump-sync\"…}." >&2
exit 1
