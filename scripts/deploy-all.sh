#!/usr/bin/env bash
# Deploys the sync server and the web app at the same time.
# Extra arguments are passed to deploy-web.sh (e.g. --zip).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LOGS="$DIR/logs"
mkdir -p "$LOGS"
STAMP="$(date +%Y%m%d-%H%M%S)"
SYNC_LOG="$LOGS/sync-$STAMP.log"
WEB_LOG="$LOGS/web-$STAMP.log"

echo "→ Deploying sync server and web app in parallel…"
"$DIR/setup-sync.sh" >"$SYNC_LOG" 2>&1 &
SYNC_PID=$!
"$DIR/deploy-web.sh" "$@" >"$WEB_LOG" 2>&1 &
WEB_PID=$!

set +e
wait "$SYNC_PID"; SYNC_RC=$?
wait "$WEB_PID";  WEB_RC=$?
set -e

report() {
  local name="$1" rc="$2" log="$3"
  if [[ "$rc" -eq 0 ]]; then echo "✓ $name: done"; else echo "✗ $name: failed (exit $rc)"; fi
  echo "  log: $log"
  tail -n 6 "$log" | sed 's/^/    /'
}
echo ""
report "Sync server (Cloudflare)" "$SYNC_RC" "$SYNC_LOG"
echo ""
report "Web app (Netlify)" "$WEB_RC" "$WEB_LOG"

[[ "$SYNC_RC" -eq 0 && "$WEB_RC" -eq 0 ]]
