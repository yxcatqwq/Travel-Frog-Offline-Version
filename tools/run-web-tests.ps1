<#
在无头 Edge 里运行 LocalFrog 的 M0/M1 验收脚本。

    pwsh -File tools/run-web-tests.ps1 [-Port 8790] [-TimeoutSeconds 90]

前置：先执行 python tools/build-local-service.py --web-only
#>
param(
    [int]$Port = 8790,
    [int]$TimeoutSeconds = 90,
    [string]$Page = 'dev/harness.html',
    [string]$Expect = 'SUMMARY phase=4'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $root 'offline_build\web_game'
$outFile = Join-Path $root 'offline_build\harness-dom.txt'
$errFile = Join-Path $root 'offline_build\harness-edge.txt'
$profileDir = Join-Path $env:TEMP ('frog-harness-' + [guid]::NewGuid().ToString('N'))
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

if (-not (Test-Path -LiteralPath (Join-Path $webDir 'js\local_service.js'))) {
    throw 'local_service.js is missing; run: python tools/build-local-service.py --web-only'
}

$python = (Get-Command python).Source
$server = Start-Process -FilePath $python -ArgumentList @('-m', 'http.server', $Port, '--bind', '127.0.0.1') `
    -WorkingDirectory $webDir -PassThru -WindowStyle Hidden

try {
    Start-Sleep -Milliseconds 800
    $url = "http://127.0.0.1:$Port/$Page"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $dom = ''
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force }
        Start-Process -FilePath $edge -Wait -NoNewWindow -ArgumentList @(
            '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-features=Translate',
            "--user-data-dir=$profileDir", '--virtual-time-budget=25000', '--dump-dom', $url
        ) -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        $dom = Get-Content -Raw -LiteralPath $outFile
        if ($dom -match [regex]::Escape($Expect)) {
            break
        }
    }
    $summary = ($dom -split "`n") | Where-Object { $_ -match 'SUMMARY|^FAIL|LocalFrog=|errors=|probe-error' }
    if (-not $summary) {
        Write-Output 'no harness summary found; raw DOM:'
        Write-Output $dom
        exit 1
    }
    $summary | ForEach-Object { Write-Output $_ }
    if (($dom -match [regex]::Escape($Expect)) -and ($dom -match 'failed=0(?:\s|<)') -and
        ($dom -notmatch '(?m)^FAIL |PAGE_ERRORS \[')) {
        exit 0
    }
    exit 2
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
}
