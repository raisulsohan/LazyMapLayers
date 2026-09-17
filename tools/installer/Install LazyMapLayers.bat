@echo off
rem LazyMapLayers - installs the panel for After Effects.
rem The .zxp next to this file is signed, so nothing else has to be installed
rem first: no extension manager, no debug switch.

setlocal EnableExtensions
title Install LazyMapLayers
cd /d "%~dp0"

set "EXT_ROOT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT_ROOT%\com.sohan.LazyMapLayers"

echo ============================================================
echo   LazyMapLayers - install
echo   Free map animation for After Effects 2024 or newer
echo ============================================================
echo.
echo Close After Effects before going on -
echo a running After Effects holds on to the old panel's files.
echo.
pause
echo.

set "ZXP="
for %%f in ("*.zxp") do set "ZXP=%%~ff"
if not defined ZXP (
  echo [!] There is no LazyMapLayers .zxp file next to this one.
  echo     Unzip the whole download first, then run this from inside that folder.
  goto :fail
)

echo Installing %ZXP%
echo         to %DEST%
echo.

if not exist "%EXT_ROOT%" mkdir "%EXT_ROOT%"
call :remove_panel
if exist "%DEST%" (
  echo [!] The old LazyMapLayers panel could not be removed.
  echo     Close After Effects and run this again.
  goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%ZXP%', '%DEST%')"
if not exist "%DEST%\CSXS\manifest.xml" (
  echo [!] The panel did not unpack. Please send the messages above to
  echo     lettertosohan@gmail.com
  goto :fail
)

echo.
echo ============================================================
echo   Installed.
echo ============================================================
echo.
echo   Open it:
echo     After Effects  Window - Extensions - LazyMapLayers
echo.
echo   Downloaded map regions and render caches from an earlier
echo   LazyMapLayers are kept.
echo.
echo   If the panel opens blank, run "Fix a blank panel.bat" and
echo   restart After Effects.
echo.
goto :end

rem ================================================================ helpers

:remove_panel
if not exist "%DEST%" exit /b 0
rem A junction - what a developer link makes - is removed with a plain rmdir,
rem which never touches the folder it points at.
dir /a:l /b "%EXT_ROOT%" 2>nul | findstr /i /x "com.sohan.LazyMapLayers" >nul
if not errorlevel 1 (
  rmdir "%DEST%"
) else (
  rmdir /s /q "%DEST%"
)
exit /b 0

:fail
echo.
echo Nothing was installed. Fix the problem above and run this again.

:end
echo.
pause
