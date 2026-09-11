<#
Starts the project Android emulator through an ASCII-only SDK path.

Android Emulator 37.1.11 on Windows can hang its QEMU CPU threads when the
SDK and system images are reached through a path containing non-ASCII text.
This project lives under such a path, so the script creates a temporary SUBST
mapping for the project root before starting the emulator.

Examples:
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-emulator.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-emulator.ps1 -Restart
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-emulator.ps1 -Headless
#>
param(
    [string]$Avd = 'FrogOfflineApi35',
    [string]$Serial = 'emulator-5554',
    [int]$WaitSeconds = 120,
    [switch]$Restart,
    [switch]$Headless
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$realSdkRoot = Join-Path $projectRoot 'tools\android-sdk'
$realEmulator = Join-Path $realSdkRoot 'emulator\emulator.exe'

if (-not (Test-Path -LiteralPath $realEmulator)) {
    throw "Android emulator not found: $realEmulator"
}

function Find-AsciiProjectDrive {
    $candidates = @('R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z')

    foreach ($letter in $candidates) {
        $candidateEmulator = "${letter}:\tools\android-sdk\emulator\emulator.exe"
        if (Test-Path -LiteralPath $candidateEmulator) {
            return $letter
        }
    }

    $subst = Join-Path $env:SystemRoot 'System32\subst.exe'
    foreach ($letter in $candidates) {
        $driveRoot = "${letter}:\"
        if (Test-Path -LiteralPath $driveRoot) {
            continue
        }

        & $subst "${letter}:" $projectRoot | Out-Null
        $candidateEmulator = "${letter}:\tools\android-sdk\emulator\emulator.exe"
        if (Test-Path -LiteralPath $candidateEmulator) {
            return $letter
        }
    }

    throw 'No free drive letter is available for the ASCII project mapping.'
}

$driveLetter = Find-AsciiProjectDrive
$sdkRoot = "${driveLetter}:\tools\android-sdk"
$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

& $adb start-server | Out-Null
$deviceLines = @(& $adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match '^emulator-\d+\s+' }
$online = $deviceLines | Where-Object { $_ -match "^$([regex]::Escape($Serial))\s+device$" }
$booted = $false
if ($online) {
    $booted = ((& $adb -s $Serial shell getprop sys.boot_completed 2>$null).Trim() -eq '1')
}

if ($booted -and -not $Restart) {
    Write-Output "$Serial is already running."
    Write-Output "SDK path: $sdkRoot"
    exit 0
}

if ($deviceLines -and $Restart) {
    & $adb -s $Serial emu kill | Out-Null
    $stopDeadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $stopDeadline) {
        Start-Sleep -Milliseconds 500
        $remaining = @(& $adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match "^$([regex]::Escape($Serial))\s+" }
        if (-not $remaining) { break }
    }
}

$logDir = Join-Path $projectRoot 'offline_build'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDir "emulator-$stamp.out.log"
$stderrLog = Join-Path $logDir "emulator-$stamp.err.log"

$emulatorArgs = @(
    '-avd', $Avd,
    '-no-snapshot-load',
    '-no-snapshot-save',
    '-gpu', 'swiftshader_indirect',
    '-no-audio'
)
if ($Headless) {
    $emulatorArgs += @('-no-window', '-no-boot-anim')
}

Start-Process -FilePath $emulator `
    -ArgumentList $emulatorArgs `
    -WorkingDirectory (Split-Path -Parent $emulator) `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog | Out-Null

Write-Output "Starting $Avd through $sdkRoot"
Write-Output "Waiting for Android to finish booting..."

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $currentDevice = @(& $adb devices) |
        Select-Object -Skip 1 |
        Where-Object { $_ -match "^$([regex]::Escape($Serial))\s+device$" }
    if (-not $currentDevice) { continue }

    $bootComplete = (& $adb -s $Serial shell getprop sys.boot_completed 2>$null).Trim()
    if ($bootComplete -eq '1') {
        Write-Output "$Serial booted successfully."
        Write-Output "stdout: $stdoutLog"
        Write-Output "stderr: $stderrLog"
        exit 0
    }
}

Write-Output "stdout: $stdoutLog"
Write-Output "stderr: $stderrLog"
throw "Timed out waiting for $Serial after $WaitSeconds seconds."
