#!/usr/bin/env bash
# Install 5 daily cron jobs to refresh the dashboard at 09:00, 10:00, 11:00,
# 12:00 and 14:00 — your computer's LOCAL time. If your Mac/PC clock is set to
# Turkey time (UTC+3), these are exactly the Turkish times you asked for.
#
# Usage:  bash install-macos-linux.sh
# Remove: bash uninstall-macos-linux.sh
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFRESH="$DIR/refresh.sh"
chmod +x "$REFRESH" 2>/dev/null || true

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ Node.js not found. Install Node 18+ (https://nodejs.org) then re-run."
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

MARK="# betas-epc-dashboard"
TMP="$(mktemp)"
# Keep any existing crontab lines except our previous ones.
crontab -l 2>/dev/null | grep -v "$MARK" > "$TMP" || true
for H in 9 10 11 12 14; do
  printf '0 %s * * * PATH="%s:$PATH" "%s" >/dev/null 2>&1 %s\n' "$H" "$NODE_DIR" "$REFRESH" "$MARK" >> "$TMP"
done
crontab "$TMP"
rm -f "$TMP"

echo "✅ Installed 5 daily refreshes at 09:00, 10:00, 11:00, 12:00, 14:00 (local time)."
echo "   Node: $NODE_BIN"
echo "   Verify: crontab -l | grep betas-epc-dashboard"
echo "   Tip: keep your computer awake at those times, or the missed run just waits for the next slot."
