@echo off
rem Shows whether the development link or a release is installed, and the PlayerDebugMode values.
rem See release-test.ps1 and docs/RELEASING.md.
title LazyMapLayers release test - status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-test.ps1" -Step status
echo.
pause
