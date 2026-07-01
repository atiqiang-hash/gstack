#!/usr/bin/env bash
# Regenerate the dashboard (curated data + live RSS + trend snapshot).
# The scheduler calls this; you can also run it by hand to refresh now.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
node generate.mjs
