@echo off
REM Regenerate the dashboard (curated data + live RSS + trend snapshot).
REM The Scheduled Task calls this; you can also double-click it to refresh now.
cd /d "%~dp0.."
node generate.mjs
