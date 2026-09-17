# Tests a release zip on the development PC, then puts the development setup back.
#
#   -Step install    save the current setup, unzip the newest release zip and show its installer
#   -Step signature  turn Adobe's signature check on (PlayerDebugMode 0) for one test session
#   -Step restore    remove the installed release, link dist/ again, restore PlayerDebugMode
#   -Step status     show what is installed and how PlayerDebugMode is set
#
# Started by the numbered .bat files next to this script. For testing the script itself, these
# environment variables point it somewhere harmless: LML_TEST_APPDATA, LML_TEST_LOCALAPPDATA,
# LML_TEST_TEMP, LML_TEST_REGISTRY (default HKCU:\Software\Adobe), LML_TEST_ZIP_DIR,
# LML_TEST_YES (answer yes), LML_TEST_NO_EXPLORER, LML_TEST_IGNORE_AE.

param([Parameter(Mandatory = $true)][ValidateSet("install", "signature", "restore", "status")][string]$Step)

$ErrorActionPreference = "Stop"

function EnvOr([string]$name, [string]$fallback) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { return $value }
    return $fallback
}

$BundleId = "com.sohan.LazyMapLayers"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Dist = Join-Path $RepoRoot "dist"
$AppData = EnvOr "LML_TEST_APPDATA" $env:APPDATA
$Extensions = Join-Path $AppData "Adobe\CEP\extensions"
$Dest = Join-Path $Extensions $BundleId
$StateDir = Join-Path (EnvOr "LML_TEST_LOCALAPPDATA" $env:LOCALAPPDATA) "LazyMapLayers release test"
$StateFile = Join-Path $StateDir "state.json"
$UnzipDir = Join-Path (EnvOr "LML_TEST_TEMP" $env:TEMP) "LazyMapLayers release test"
$Registry = EnvOr "LML_TEST_REGISTRY" "HKCU:\Software\Adobe"
$CsxsVersions = 8..14

function Say([string]$text) { Write-Host $text }
function Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Good([string]$text) { Write-Host $text -ForegroundColor Green }
function Stop-Test([string]$text) {
    Write-Host ""
    Write-Host "[!] $text" -ForegroundColor Red
    exit 1
}

function Confirm-Step([string]$question) {
    if ($env:LML_TEST_YES) { return $true }
    $answer = Read-Host "$question [y/N]"
    return $answer -match "^[yY]"
}

function Assert-AeClosed {
    if ($env:LML_TEST_IGNORE_AE) { return }
    $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "AfterFX*" }
    if ($running) { Stop-Test "After Effects is running. Close it and run this again." }
}

function Test-Link([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $item = Get-Item -LiteralPath $path -Force
    return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-InstallKind {
    if (-not (Test-Path -LiteralPath $Dest)) { return "none" }
    if (Test-Link $Dest) { return "link" }
    if (Test-Path -LiteralPath (Join-Path $Dest "META-INF\signatures.xml")) { return "release" }
    return "folder"
}

function Get-ManifestVersion([string]$folder) {
    $manifest = Join-Path $folder "CSXS\manifest.xml"
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    $text = [IO.File]::ReadAllText($manifest)
    if ($text -notmatch "ExtensionBundleId=`"$BundleId`"") { return $null }
    if ($text -match 'ExtensionBundleVersion="([^"]+)"') { return $Matches[1] }
    return "?"
}

function Get-DebugModes {
    $modes = [ordered]@{}
    foreach ($v in $CsxsVersions) {
        $key = "$Registry\CSXS.$v"
        if (-not (Test-Path $key)) { continue }
        $value = (Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
        $modes["CSXS.$v"] = $value
    }
    return $modes
}

function Save-State {
    if (Test-Path -LiteralPath $StateFile) {
        Say "The setup before testing is already saved (from an earlier step); it is kept."
        return
    }
    $linkTarget = $null
    if (Test-Link $Dest) { $linkTarget = (Get-Item -LiteralPath $Dest -Force).Target | Select-Object -First 1 }
    $state = [ordered]@{
        saved = (Get-Date).ToString("s")
        install = (Get-InstallKind)
        linkTarget = $linkTarget
        debugModes = (Get-DebugModes)
    }
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    [IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Depth 4))
    Say "Saved the setup before testing to $StateFile"
}

function Show-Status {
    Say ""
    Say "---------------------------------------------------------------"
    $kind = Get-InstallKind
    switch ($kind) {
        "none" { Say "LazyMapLayers panel:  not installed" }
        "link" {
            $target = (Get-Item -LiteralPath $Dest -Force).Target | Select-Object -First 1
            Say "LazyMapLayers panel:  DEVELOPMENT link -> $target"
        }
        "release" { Say ("LazyMapLayers panel:  RELEASE install, version " + (Get-ManifestVersion $Dest) + ", signed") }
        "folder" { Say "LazyMapLayers panel:  an unsigned folder copy" }
    }
    $modes = Get-DebugModes
    $parts = @()
    foreach ($name in $modes.Keys) {
        $value = $modes[$name]
        if ($null -eq $value) { $value = "not set" }
        $parts += "$name=$value"
    }
    Say ("PlayerDebugMode:      " + ($parts -join "  "))
    # After Effects 2024 reads CSXS.11; After Effects 2025 and 2026 read CSXS.12.
    $check = "mixed: CSXS.11 and CSXS.12 differ"
    if ($modes["CSXS.11"] -eq "1" -and $modes["CSXS.12"] -eq "1") { $check = "OFF (unsigned panels load; development setup)" }
    elseif ($modes["CSXS.11"] -ne "1" -and $modes["CSXS.12"] -ne "1") { $check = "ON (only signed panels load, as on a user's computer)" }
    Say "Signature check:      $check"
    if (Test-Path -LiteralPath $StateFile) { Say "Saved setup:          yes (restore with step 3)" } else { Say "Saved setup:          none" }
    Say "---------------------------------------------------------------"
}

function Find-Zip {
    $dirs = @()
    if ($env:LML_TEST_ZIP_DIR) { $dirs += $env:LML_TEST_ZIP_DIR }
    $dir = Split-Path $RepoRoot -Parent
    while ($dir) {
        foreach ($name in @("00. Install from here", "00 Install from here")) { $dirs += (Join-Path $dir $name) }
        $parent = Split-Path $dir -Parent
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    foreach ($candidate in $dirs) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $zip = Get-ChildItem -LiteralPath $candidate -Filter "LazyMapLayers-v*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($zip) { return $zip.FullName }
    }
    return $null
}

function Step-Install {
    Assert-AeClosed
    $zip = Find-Zip
    if (-not $zip) { Stop-Test "No LazyMapLayers-v*.zip found in the ""00. Install from here"" folder. Run node tools/package-zxp.mjs first." }
    Save-State
    if (Test-Path -LiteralPath $UnzipDir) { [IO.Directory]::Delete($UnzipDir, $true) }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $UnzipDir)
    $folder = Join-Path $UnzipDir "LazyMapLayers"
    if (-not (Test-Path -LiteralPath (Join-Path $folder "Install LazyMapLayers.bat"))) { Stop-Test "The zip does not contain LazyMapLayers\Install LazyMapLayers.bat." }
    Good "Unzipped $zip"
    Say "      to $folder"
    Say ""
    Say "Now do what a user does: in the folder that opens, double-click"
    Say "  Install LazyMapLayers.bat"
    Say "It replaces the development link for now; step 3 puts it back."
    if (-not $env:LML_TEST_NO_EXPLORER) { Start-Process explorer.exe -ArgumentList "`"$folder`"" }
    Show-Status
}

function Step-Signature {
    Assert-AeClosed
    if ((Get-InstallKind) -ne "release") {
        Stop-Test "The release is not installed yet. Run step 1 and its installer first."
    }
    Save-State
    Say "This sets Adobe's PlayerDebugMode to 0 for your user account, so After Effects"
    Say "checks panel signatures the way it does on a user's computer."
    Say "While it is on, unsigned panels (development links, some older panels) do not"
    Say "load and After Effects may say so. Step 3 puts every value back as it was."
    Say ""
    if (-not (Confirm-Step "Turn the signature check on now?")) { Say "Nothing changed."; Show-Status; return }
    foreach ($v in $CsxsVersions) {
        $key = "$Registry\CSXS.$v"
        if (Test-Path $key) { Set-ItemProperty -Path $key -Name PlayerDebugMode -Value "0" -Type String }
    }
    Good "Signature check is on. Start After Effects and open Window > Extensions > LazyMapLayers."
    Show-Status
}

function Step-Restore {
    Assert-AeClosed
    $state = $null
    if (Test-Path -LiteralPath $StateFile) { $state = [IO.File]::ReadAllText($StateFile) | ConvertFrom-Json }

    # The panel: remove a release install (never a link's target), then link dist/ again.
    $kind = Get-InstallKind
    if ($kind -eq "release" -or $kind -eq "folder") {
        if (-not (Get-ManifestVersion $Dest)) { Stop-Test "$Dest does not look like LazyMapLayers; not touching it." }
        [IO.Directory]::Delete($Dest, $true)
        Say "Removed the release install."
    } elseif ($kind -eq "link") {
        [IO.Directory]::Delete($Dest, $false)
    }
    if (-not $state -or $state.install -eq "link") {
        $target = $Dist
        if ($state -and $state.linkTarget) { $target = $state.linkTarget }
        if (-not (Test-Path -LiteralPath (Join-Path $target "CSXS\manifest.xml"))) {
            Warn "$target has no build; run npm run build:dev in the repository, then this step again."
        }
        New-Item -ItemType Directory -Force -Path $Extensions | Out-Null
        New-Item -ItemType Junction -Path $Dest -Target $target | Out-Null
        Good "Linked $Dest -> $target"
        if (-not (Test-Path -LiteralPath (Join-Path $target ".debug"))) {
            Warn "$target is not a development build (no .debug file); run npm run build:dev for DevTools and the in-AE tests."
        }
    } else {
        Say "There was no development link before testing, so none is made."
    }

    # PlayerDebugMode: back to the saved values.
    if ($state) {
        foreach ($property in $state.debugModes.PSObject.Properties) {
            $key = "$Registry\" + $property.Name
            if (-not (Test-Path $key)) { continue }
            if ($null -eq $property.Value) {
                Remove-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue
            } else {
                Set-ItemProperty -Path $key -Name PlayerDebugMode -Value ([string]$property.Value) -Type String
            }
        }
        Good "PlayerDebugMode is back to the values saved on $($state.saved)."
        [IO.File]::Delete($StateFile)
    } else {
        Warn "No saved setup was found, so PlayerDebugMode was left as it is."
    }
    if (Test-Path -LiteralPath $UnzipDir) { [IO.Directory]::Delete($UnzipDir, $true) }
    Show-Status
}

switch ($Step) {
    "install" { Step-Install }
    "signature" { Step-Signature }
    "restore" { Step-Restore }
    "status" { Show-Status }
}
