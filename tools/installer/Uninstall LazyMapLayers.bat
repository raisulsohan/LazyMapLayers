@echo off
rem LazyMapLayers - removes the panel. Downloaded map regions, the render queue
rem and renders made without a saved project are removed too, but only if you
rem say so. Renders next to your saved projects stay where they are.

setlocal EnableExtensions
title Uninstall LazyMapLayers
set "EXT_ROOT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT_ROOT%\com.sohan.LazyMapLayers"
set "DATA=%APPDATA%\LazyMapLayers"

echo Removing the LazyMapLayers panel...
echo Close After Effects first.
echo.
pause

if not exist "%DEST%" (
  echo The panel was not installed.
  goto :data
)

dir /a:l /b "%EXT_ROOT%" 2>nul | findstr /i /x "com.sohan.LazyMapLayers" >nul
if not errorlevel 1 (rmdir "%DEST%") else (rmdir /s /q "%DEST%")

if exist "%DEST%" (
  echo [!] Could not remove it - After Effects is probably still open.
  goto :end
)
echo Removed the panel.

:data
if not exist "%DATA%" goto :done
echo.
echo LazyMapLayers keeps downloaded map regions, the render queue and
echo renders of unsaved projects in
echo   %DATA%
echo Keep them if you might install LazyMapLayers again.
choice /c YN /m "Delete them as well"
if errorlevel 2 goto :done
rmdir /s /q "%DATA%"
if exist "%DATA%" (
  echo [!] Could not remove it - close After Effects and try again.
) else (
  echo Removed the downloaded regions and renders.
)

:done
echo.
echo Renders of saved projects stay in the "LazyMapLayers Renders" folders
echo next to those projects.

:end
echo.
pause
