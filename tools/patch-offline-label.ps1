$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$inputPath = Join-Path $root 'offline_build\travel_frog_local_unsigned.apk'
$outputPath = Join-Path $root 'offline_build\travel_frog_local_labeled_unsigned.apk'
if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }

function Read-Bytes([System.IO.Compression.ZipArchiveEntry]$entry) {
    $src = $entry.Open(); $ms = [IO.MemoryStream]::new()
    try { $src.CopyTo($ms); return ,$ms.ToArray() } finally { $ms.Dispose(); $src.Dispose() }
}

function Patch-InPlace([byte[]]$bytes, [byte[]]$old, [byte[]]$new) {
    $hits = 0
    for ($i = 0; $i -le $bytes.Length - $old.Length; $i++) {
        $match = $true
        for ($j = 0; $j -lt $old.Length; $j++) {
            if ($bytes[$i + $j] -ne $old[$j]) { $match = $false; break }
        }
        if ($match) {
            [Array]::Copy($new, 0, $bytes, $i, $new.Length)
            $hits++
            $i += $old.Length - 1
        }
    }
    return $hits
}

$oldText = [string]::new([char[]](0x65c5,0x884c,0x9752,0x86d9,0x00b7,0x4e2d,0x56fd,0x4e4b,0x65c5))
$newText = [string]::new([char[]](0x65c5,0x884c,0x9752,0x86d9,0x00b7,0x672c,0x5730,0x7248,0x672c))
$old = [Text.Encoding]::UTF8.GetBytes($oldText)
$new = [Text.Encoding]::UTF8.GetBytes($newText)
if ($old.Length -ne $new.Length) { throw 'Label replacements must have equal byte lengths.' }

$source = [IO.Compression.ZipFile]::OpenRead($inputPath)
$file = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$target = [IO.Compression.ZipArchive]::new($file, [IO.Compression.ZipArchiveMode]::Create, $false)
$hits = 0
try {
    foreach ($entry in $source.Entries) {
        if ($entry.FullName -like 'META-INF/*' -or $entry.FullName.EndsWith('/')) { continue }
        $bytes = Read-Bytes $entry
        if ($entry.FullName -eq 'resources.arsc') {
            Write-Output "resource bytes type=$($bytes.GetType().FullName) length=$($bytes.Length)"
            $hits = Patch-InPlace $bytes $old $new
            $out = $target.CreateEntry($entry.FullName, [IO.Compression.CompressionLevel]::NoCompression)
        } else {
            $out = $target.CreateEntry($entry.FullName, [IO.Compression.CompressionLevel]::Optimal)
        }
        $stream = $out.Open()
        try { if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) } } finally { $stream.Dispose() }
    }
} finally {
    $target.Dispose(); $file.Dispose(); $source.Dispose()
}
if ($hits -ne 1) { throw "Expected one label replacement, found $hits." }
Write-Output "Created labeled APK: $outputPath"
