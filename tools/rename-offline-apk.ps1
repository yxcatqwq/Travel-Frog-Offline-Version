$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$inputPath = Join-Path $root 'offline_build\travel_frog_offline_unsigned.apk'
$outputPath = Join-Path $root 'offline_build\travel_frog_local_unsigned.apk'
if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing input APK: $inputPath"
}
if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

function Replace-Bytes([byte[]]$source, [byte[]]$old, [byte[]]$new) {
    if ($old.Length -ne $new.Length) {
        throw 'Binary replacements must have equal length.'
    }
    $result = [System.Collections.Generic.List[byte]]::new()
    $i = 0
    while ($i -lt $source.Length) {
        $match = $false
        if ($i + $old.Length -le $source.Length) {
            $match = $true
            for ($j = 0; $j -lt $old.Length; $j++) {
                if ($source[$i + $j] -ne $old[$j]) { $match = $false; break }
            }
        }
        if ($match) {
            $result.AddRange($new)
            $i += $old.Length
        } else {
            $result.Add($source[$i])
            $i++
        }
    }
    return $result.ToArray()
}

function Read-EntryBytes([System.IO.Compression.ZipArchiveEntry]$entry) {
    $stream = $entry.Open()
    $memory = [System.IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); return $memory.ToArray() } finally {
        $memory.Dispose()
        $stream.Dispose()
    }
}

function Write-EntryBytes([System.IO.Compression.ZipArchive]$archive, [string]$name, [byte[]]$bytes, [bool]$store) {
    if ($null -eq $bytes) { $bytes = [byte[]]::new(0) }
    $level = if ($store) { [System.IO.Compression.CompressionLevel]::NoCompression } else { [System.IO.Compression.CompressionLevel]::Optimal }
    $entry = $archive.CreateEntry($name, $level)
    $stream = $entry.Open()
    try { if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) } } finally { $stream.Dispose() }
}

$oldPackage = [Text.Encoding]::Unicode.GetBytes('com.aligames.lxqw.hhb')
$newPackage = [Text.Encoding]::Unicode.GetBytes('com.offline.frog.appx')
$oldLabel = [Text.Encoding]::UTF8.GetBytes('旅行青蛙·中国之旅')
$newLabel = [Text.Encoding]::UTF8.GetBytes('旅行青蛙·本地版本')
if ($oldPackage.Length -ne $newPackage.Length -or $oldLabel.Length -ne $newLabel.Length) {
    throw 'Replacement strings do not have equal byte lengths.'
}

$source = [IO.Compression.ZipFile]::OpenRead($inputPath)
$file = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$target = [IO.Compression.ZipArchive]::new($file, [IO.Compression.ZipArchiveMode]::Create, $false)
$packageHits = 0
$labelHits = 0
try {
    foreach ($entry in $source.Entries) {
        if ($entry.FullName -like 'META-INF/*') { continue }
        if ($entry.FullName.EndsWith('/')) { continue }
        $bytes = Read-EntryBytes $entry
        if ($entry.FullName -eq 'AndroidManifest.xml') {
            $before = $bytes
            $bytes = Replace-Bytes $bytes $oldPackage $newPackage
            $packageHits = $packageHits + (($before.Length - $bytes.Length) / $oldPackage.Length)
            if ($bytes.Length -ne $before.Length) { throw 'Manifest size changed unexpectedly.' }
            Write-EntryBytes $target $entry.FullName $bytes $true
        } elseif ($entry.FullName -eq 'resources.arsc') {
            $before = $bytes
            $bytes = Replace-Bytes $bytes $oldLabel $newLabel
            $labelHits = $labelHits + (($before.Length - $bytes.Length) / $oldLabel.Length)
            Write-EntryBytes $target $entry.FullName $bytes $true
        } else {
            Write-EntryBytes $target $entry.FullName $bytes $false
        }
    }
} finally {
    $target.Dispose()
    $file.Dispose()
    $source.Dispose()
}

Write-Output "Created renamed unsigned APK: $outputPath"
Write-Output "Package replacements: $packageHits"
Write-Output "Label replacements: $labelHits"
