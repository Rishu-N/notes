#!/usr/bin/env bash
# Publishes the Dump web app (the web/ folder).
#   scripts/deploy-web.sh         → deploy to Netlify with the CLI (run `npx netlify-cli login` first)
#   scripts/deploy-web.sh --zip   → just make a zip to drag onto https://app.netlify.com/drop
# Either way it bumps the offline-cache version so phones and laptops pick up the new app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
MODE="${1:-netlify}"

VERSION="dump-$(date -u +%Y%m%d%H%M%S)"
sed -i '' -E "s/^const VERSION = '[^']*';/const VERSION = '$VERSION';/" "$WEB/sw.js"
grep -q "const VERSION = '$VERSION';" "$WEB/sw.js" || { echo "✗ Couldn't update VERSION in web/sw.js" >&2; exit 1; }
echo "✓ Offline cache version → $VERSION"

cp "$WEB/index.html" "$WEB/dump.html"
echo "✓ web/dump.html refreshed from index.html"

if [[ "$MODE" == "--zip" ]]; then
  ZIP="$ROOT/dump-web-$(date +%Y-%m-%d-%H%M).zip"
  (cd "$WEB" && zip -qr "$ZIP" . -x '.*')
  echo "✓ Created $ZIP"
  echo "  Drag the web folder (or this zip) onto https://app.netlify.com/drop — or onto your site's Deploys page to update it."
  exit 0
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "✗ Node.js is not installed. Install it from https://nodejs.org, or use:  scripts/deploy-web.sh --zip" >&2
  exit 1
fi

NETLIFY=(npx --yes netlify-cli)
if ! "${NETLIFY[@]}" status >/dev/null 2>&1; then
  echo "✗ Not logged in to Netlify. Run once:  npx netlify-cli login" >&2
  exit 1
fi

cd "$ROOT"
if [[ ! -f "$ROOT/.netlify/state.json" ]]; then
  echo "ℹ This folder isn't linked to a Netlify site yet."
  echo "  Run 'npx netlify-cli link' to use an existing site, or continue and Netlify will create a new one."
fi

echo "→ Deploying web/ to Netlify…"
"${NETLIFY[@]}" deploy --prod --dir "$WEB"
echo "✓ Web app deployed. Open the URL above on your phone and laptop."
