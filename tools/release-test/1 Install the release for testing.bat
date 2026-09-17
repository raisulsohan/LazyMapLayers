@echo off
rem Step 1: saves the development setup and unzips the newest release zip, ready for its installer.
rem See release-test.ps1 and docs/RELEASING.md.
title LazyMapLayers release test - 1 install the release
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-test.ps1" -Step install
echo.
pause
