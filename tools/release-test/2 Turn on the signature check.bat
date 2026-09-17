@echo off
rem Step 2 (optional): turns Adobe's signature check on for a test session, like on a user's computer.
rem See release-test.ps1 and docs/RELEASING.md.
title LazyMapLayers release test - 2 signature check
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-test.ps1" -Step signature
echo.
pause
