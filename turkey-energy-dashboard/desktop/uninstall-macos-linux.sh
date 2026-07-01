#!/usr/bin/env bash
# Remove the dashboard's daily cron jobs.
set -e
crontab -l 2>/dev/null | grep -v "# betas-epc-dashboard" | crontab - 2>/dev/null || true
echo "✅ Removed the dashboard cron jobs."
