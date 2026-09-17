@echo off
rem Step 3: removes the release install, links dist/ again and restores PlayerDebugMode.
rem See release-test.ps1 and docs/RELEASING.md.
title LazyMapLayers release test - 3 back to development
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-test.ps1" -Step restore
echo.
pause
