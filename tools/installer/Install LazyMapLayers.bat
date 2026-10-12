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

rem The map data. The full download carries two packs: offline-data (the
rem whole world to zoom 9, elevation, satellite pictures and every country's
rem districts) and light-data (the world to zoom 6 and coarse elevation). The
rem light download carries only light-data. Online keeps neither: the panel
rem fetches the detail maps need from the internet, and keeps it.
set "DATA=%APPDATA%\LazyMapLayers"
set "HAS_FULL=0"
set "HAS_LIGHT=0"
if exist "offline-data\offline\world.pmtiles" set "HAS_FULL=1"
if exist "light-data\offline\world.pmtiles" set "HAS_LIGHT=1"
set "MODE=online"
if "%HAS_FULL%%HAS_LIGHT%"=="00" goto :copy_data
set "DEFAULT=2"
if "%HAS_FULL%"=="1" set "DEFAULT=1"
echo.
echo How much map data should this computer keep?
echo.
if "%HAS_FULL%"=="1" echo   1  Full     about 2 GB: the world down to city level, elevation,
if "%HAS_FULL%"=="1" echo              satellite pictures and every country's districts.
if "%HAS_FULL%"=="1" echo              Everything works without the internet.
if "%HAS_LIGHT%"=="1" echo   2  Light    about 120 MB: the world to country level and coarse
if "%HAS_LIGHT%"=="1" echo              elevation. Closer detail comes from the internet as
if "%HAS_LIGHT%"=="1" echo              your maps need it, and is kept.
echo   3  Online   nothing more: all detail comes from the internet as
echo              your maps need it, and is kept.
echo.
:ask_mode
set "PICK="
set /p "PICK=Type 1, 2 or 3 and press Enter (Enter alone: %DEFAULT%): "
if not defined PICK set "PICK=%DEFAULT%"
rem A quote typed by mistake would break the comparisons below; it is not a choice anyway.
set "PICK=%PICK:"=%"
set "MODE="
if "%PICK%"=="1" if "%HAS_FULL%"=="1" set "MODE=full"
if "%PICK%"=="2" if "%HAS_LIGHT%"=="1" set "MODE=light"
if "%PICK%"=="3" set "MODE=online"
if not defined MODE (
  echo That is not one of the choices above.
  goto :ask_mode
)

:copy_data
rem Robocopy skips files that are already there and unchanged, so installing
rem again is quick, and it replaces the world files of another choice made
rem before. Exit codes below 8 mean success.
if "%MODE%"=="full" (
  echo.
  echo Copying the map data for working offline ^(about 2 GB^)
  echo         to %DATA%
  echo This takes a minute or two.
  robocopy "offline-data" "%DATA%" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 >nul
  if errorlevel 8 (
    echo [!] The map data could not be copied completely. Check that the disk
    echo     has about 2 GB free, then run this again. The panel itself is installed.
    goto :fail_data
  )
  echo The map data is in place.
)
if "%MODE%"=="light" (
  echo.
  echo Copying the light map data ^(about 120 MB^)
  echo         to %DATA%
  robocopy "light-data" "%DATA%" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 >nul
  if errorlevel 8 (
    echo [!] The map data could not be copied completely. Check that the disk
    echo     has about 150 MB free, then run this again. The panel itself is installed.
    goto :fail_data
  )
  echo The map data is in place.
)
rem Online after a full or light install: the world files that install
rem copied go, so they no longer take the space. Downloads are kept.
if "%MODE%"=="online" if exist "%DATA%\offline\pack.json" (
  echo.
  echo Removing the offline world map an earlier install copied to
  echo         %DATA%
  del /q "%DATA%\offline\world.pmtiles" "%DATA%\offline\pack.json" "%DATA%\offline\CREDITS.txt" 2>nul
  del /q "%DATA%\terrain\world.pmtiles" 2>nul
)

echo.
echo ============================================================
echo   Installed.
echo ============================================================
echo.
echo   Open it:
echo     After Effects  Window - Extensions - LazyMapLayers
echo.
if "%MODE%"=="full" (
  echo   It works without the internet: the world map down to city
  echo   level, elevation, satellite pictures and the districts of
  echo   every country are on this computer now. Closer than city
  echo   level, street detail comes from the internet as maps need it.
  echo.
)
if "%MODE%"=="light" (
  echo   The world to country level and coarse elevation are on this
  echo   computer. Closer detail comes from the internet as your maps
  echo   need it, and is kept for working offline later.
  echo.
)
if "%MODE%"=="online" (
  echo   Map detail closer than country level comes from the internet
  echo   as your maps need it, and is kept for working offline later.
  echo.
)
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
goto :end

:fail_data
echo.
echo The panel is installed and works; the offline map data is not complete yet.

:end
echo.
pause
