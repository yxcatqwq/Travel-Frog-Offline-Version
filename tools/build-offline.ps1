$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$inputPath = Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -like '*.apk.1' -or $_.Extension -eq '.apk' } | Select-Object -First 1
if (-not $inputPath) {
    throw 'No APK file found in the project directory.'
}

$outputDir = Join-Path $root 'offline_build'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$unsignedPath = Join-Path $outputDir 'travel_frog_offline_unsigned.apk'
if (Test-Path -LiteralPath $unsignedPath) {
    Remove-Item -LiteralPath $unsignedPath -Force
}

function Read-ZipText([System.IO.Compression.ZipArchiveEntry]$entry) {
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Write-ZipText([System.IO.Compression.ZipArchive]$archive, [string]$name, [string]$text) {
    $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write($text) } finally { $writer.Dispose() }
}

$source = [System.IO.Compression.ZipFile]::OpenRead($inputPath.FullName)
$targetStream = [System.IO.File]::Open($unsignedPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
$target = [System.IO.Compression.ZipArchive]::new($targetStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)

try {
    foreach ($entry in $source.Entries) {
        if ($entry.FullName -like 'META-INF/*') {
            continue
        }

        if ($entry.FullName -eq 'assets/game/index.html') {
            $html = Read-ZipText $entry
            $html = $html -replace 'loadSingleScript\("https://ali-lxqw-hotfix\.ejoy\.com/c1_client/release/lingxi/android/launcherv2\.js"\+"\?="\+Math\.random\(\)\);', 'loadSingleScript("launcher.js");'
            Write-ZipText $target $entry.FullName $html
            continue
        }

        if ($entry.FullName -eq 'assets/game/launcher.js') {
            $launcher = Read-ZipText $entry
            $start = $launcher.IndexOf('rmtRequest(function () {', [System.StringComparison]::Ordinal)
            if ($start -lt 0) {
                throw 'Could not find the remote manifest launcher block.'
            }
            $localManifest = @'
// Offline build: load only the manifest bundled in this APK.
window.launchInfo = "local_offline";
httpRequest(manifestName, function () {
    window.launchInfo = "local_failed";
    onHttpLoad({ initial: [], game: [], version: "1001" });
}, function (manifest) {
    onHttpLoad(manifest);
});
'@
            $launcher = $launcher.Substring(0, $start) + $localManifest.Trim() + "`r`n"
            Write-ZipText $target $entry.FullName $launcher
            continue
        }

        if ($entry.FullName -eq 'assets/game/resource/China/config/gameConfig.json') {
            $config = Read-ZipText $entry | ConvertFrom-Json
            $config.channelType = 1
            $config.serverList.server_12.gameServer = @('ws://127.0.0.1:9')
            $config.serverList.server_13.gameServer = @('ws://127.0.0.1:9')
            $config.serverList.server_12.maintain = ''
            $config.serverList.server_13.maintain = ''
            $json = $config | ConvertTo-Json -Depth 20
            Write-ZipText $target $entry.FullName $json
            continue
        }

        $newEntry = $target.CreateEntry($entry.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
        $inputStream = $entry.Open()
        $outputStream = $newEntry.Open()
        try { $inputStream.CopyTo($outputStream) } finally {
            $outputStream.Dispose()
            $inputStream.Dispose()
        }
    }
}
finally {
    $target.Dispose()
    $targetStream.Dispose()
    $source.Dispose()
}

Write-Output "Created unsigned APK: $unsignedPath"
