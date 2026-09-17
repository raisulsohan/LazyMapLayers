@echo off
rem Only needed if LazyMapLayers opens as a blank panel.
rem
rem Adobe checks a panel's signature as the app loads it, and on some computers
rem that check fails even for a correctly signed panel. The switch below tells
rem Adobe's extension layer to load the panel anyway. It is Adobe's own setting,
rem it lives under the current user only, and other panels you have installed
rem may already rely on it.

setlocal EnableExtensions
title LazyMapLayers - fix a blank panel

echo This turns on Adobe's "PlayerDebugMode" for your user account, which lets
echo Adobe apps load a panel whose signature check did not complete.
echo.
choice /c YN /m "Turn it on now"
if errorlevel 2 goto :end

for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Done. Restart After Effects and open the panel again.
echo If it is still blank, email lettertosohan@gmail.com with your After Effects version.

:end
echo.
pause
