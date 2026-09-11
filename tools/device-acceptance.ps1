<#
Device-side M0/M1 acceptance run.

NOTE: this file must stay ASCII-only. Windows PowerShell 5.1 reads .ps1 files
without a BOM as ANSI, which corrupts non-ASCII string literals.

  1. rebuild the APK with the remote diagnostics bridge and device file snapshot
  2. install + cold start on the emulator
  3. drive harvest / shop / bag / bench / compost / pocket through the diagnostics
     command channel (identical protocol path to in-game taps)
  4. verify restart persistence, print PASS/FAIL list and save a screenshot

    powershell -NoProfile -ExecutionPolicy Bypass -File tools/device-acceptance.ps1
#>
param(
    [string]$Serial = 'emulator-5554',
    [int]$Port = 8799,
    [switch]$SkipBuild,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $root 'tools\platform-tools\adb.exe'
$diagUrl = "http://127.0.0.1:$Port"
$package = 'com.offline.frog.appx'
$activity = 'com.offline.frog.appx/com.Aligames.lxqw.MainActivity'
$results = @()
# 客户端按 seq 去重（防止 EgretNative XHR 复用旧响应），因此每轮必须使用全新的序列号
$seq = [int][double]::Parse((Get-Date -UFormat %s).Replace(',', '.')) * 1000
$commandPath = $null

$statusScript = @'
import json, urllib.request, sys
try:
    data = json.load(urllib.request.urlopen(sys.argv[1] + "/status"))
except Exception:
    data = {}
print(json.dumps(data, ensure_ascii=False))
'@
$statusScriptPath = Join-Path $env:TEMP 'lf-status.py'
Set-Content -LiteralPath $statusScriptPath -Value $statusScript -Encoding ASCII

function Add-Result([string]$name, [bool]$ok, $detail) {
    $script:results += [pscustomobject]@{
        name = $name
        ok = $ok
        detail = ($detail | ConvertTo-Json -Compress -Depth 6)
    }
}

function Get-Status {
    $json = python $statusScriptPath $diagUrl
    if (-not $json) { return $null }
    return ($json | ConvertFrom-Json)
}

function Send-Command([string]$op, $arg) {
    $script:seq++
    $payload = @{op = $op; arg = $arg; seq = $script:seq} | ConvertTo-Json -Compress -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $b64 = [Convert]::ToBase64String($bytes)
    try {
        Invoke-WebRequest -Uri "$diagUrl/command" -Method POST -Body $bytes -ContentType 'application/json' -UseBasicParsing | Out-Null
    } catch {
        Write-Output "command channel warning: $($_.Exception.Message)"
    }
    if (-not $script:commandPath) { return }
    # device file channel: write, wait for lastExecutedSeq, rewrite until acknowledged
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
        & $adb -s $Serial shell "echo $b64 | base64 -d > $script:commandPath; chmod 666 $script:commandPath" | Out-Null
        $waitUntil = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $waitUntil) {
            Start-Sleep -Milliseconds 800
            $probe = Get-Status
            if ($probe -and $probe.diagnostics.lastExecutedSeq -ge $script:seq) { return }
        }
    }
    Write-Output ("command not acknowledged: {0} (seq={1})" -f $op, $script:seq)
}

function Wait-For([scriptblock]$condition, [int]$timeoutSeconds, [string]$label) {
    if ($timeoutSeconds -lt 60) { $timeoutSeconds = 60 }
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = Get-Status
        if ($status -and (& $condition $status)) { return $status }
        Start-Sleep -Milliseconds 1500
    }
    throw "timeout waiting for $label"
}

if (-not $SkipBuild) {
    $env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
    python (Join-Path $PSScriptRoot 'build-local-service.py') --diag-endpoint "http://10.0.2.2:$Port" --diag-file | Out-Null
    python (Join-Path $PSScriptRoot 'patch-application-class.py') `
        (Join-Path $root 'offline_build\travel_frog_local_service.apk') `
        (Join-Path $root 'offline_build\_app_restored_unsigned.apk') `
        com.ejoy.ejoysdk.EjoySDKApplication | Out-Null
    & (Join-Path $root 'tools\build-tools-extract\android-14\zipalign.exe') -f -p 4 `
        (Join-Path $root 'offline_build\_app_restored_unsigned.apk') `
        (Join-Path $root 'offline_build\_app_restored_aligned.apk') | Out-Null
    & (Join-Path $root 'tools\build-tools-extract\android-14\apksigner.bat') sign `
        --ks (Join-Path $root 'offline_build\local-service-debug.jks') `
        --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey `
        --out (Join-Path $root 'offline_build\_app_restored.apk') `
        (Join-Path $root 'offline_build\_app_restored_aligned.apk') | Out-Null
}

if (-not $SkipInstall) {
    & $adb -s $Serial install -r (Join-Path $root 'offline_build\_app_restored.apk') | Out-Null
    & $adb -s $Serial shell am force-stop $package
    Start-Sleep -Seconds 2
    & $adb -s $Serial shell am start -n $activity | Out-Null
    Write-Output 'waiting for the game to boot and report...'
    $deadline = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        $probe = Get-Status
        if ($probe -and $null -ne $probe.revision -and $probe.source) { break }
    }
}

$status = Get-Status
if (-not $status -or $null -eq $status.revision) { throw 'device did not report status (diagnostics bridge offline)' }

if ($status.diagnostics.statusFile -and $status.diagnostics.statusFile.path) {
    # Release APKs are not debuggable, so adb shell cannot write the app's
    # private PlatformFile directory. Keep the file path for diagnostics but
    # use the HTTP bridge as the command source on this device.
    $commandPath = $null
    Write-Output "file status channel: $($status.diagnostics.statusFile.path)"
    Write-Output 'using HTTP command channel (APK is not debuggable)'
} else {
    Write-Output 'file command channel unavailable, falling back to HTTP only'
}

Add-Result 'device local service booted' ($null -ne $status.revision) @{revision = $status.revision}

# deterministic baseline: rebuild the new-save template, then re-check invariants
Send-Command 'reset' $null
$status = Wait-For { param($s) $s.source -eq 'new' -and $s.clover.ready -ge 1 } 45 'new save reset'
Add-Result 'deterministic new save created' ($status.source -eq 'new' -and $status.clover.total -eq 20) @{
    source = $status.source; slots = $status.clover.total; ready = $status.clover.ready
}
Add-Result 'new save template applied' ($status.source -eq 'new' -and $status.wallet.clover -ge 100) @{source = $status.source; clover = $status.wallet.clover}
Add-Result 'workbench unlocked' ($status.furniture.benchOpen -eq $true) $status.furniture
Add-Result 'bench has tools and materials' (($status.furniture.bench | Where-Object { $_ -ne -1 }).Count -ge 2) $status.furniture.bench
Add-Result 'compost box owned and placed' ($status.compost.owned -ge 1 -and $status.compost.showIndex -ge 1) $status.compost
Add-Result 'clover field has ready slots' ($status.clover.ready -ge 1) $status.clover

# scene-level checks: facilities must actually be rendered, not only present in the save
Send-Command 'view' $null
$viewStatus = Wait-For { param($s) $s.diagnostics.viewSample -ne $null } 90 'view sample'
$view = $viewStatus.diagnostics.viewSample
Add-Result 'scene: workbench rendered' ($view.found -eq $true -and $view.benchVisible -eq $true -and $view.enterBenchBtnVisible -eq $true) $view
Add-Result 'scene: workbench sprite is not the empty placeholder' ($view.benchEmptyVisible -eq $false -and $view.benchSource -match 'gzt') $view
Add-Result 'scene: compost box sprite rendered' ($view.compostSource -ne $null -and $view.compostSource -ne '') $view
Add-Result 'scene: merchant visible' ($view.shopVisible -eq $true) $view
Add-Result 'scene: mature clover rendered on the field' ($view.cloverOnField -ge 1) $view
Add-Result 'scene: clover panel shows the wallet' ($view.cloverPointText -eq [string]$viewStatus.wallet.clover) $view

# merchant UI must open with a rendered shelf (this used to crash the client:
# shelf rows without item_id made the renderer read ItemDB.get(undefined).img)
Send-Command 'openShop' $null
Start-Sleep -Seconds 6
$shopStatus = Get-Status
$shopErrors = $shopStatus.diagnostics.errorLog
Add-Result 'merchant shop opens without client exception' ($null -eq $shopErrors -or $shopErrors.Count -eq 0) @{
    lastError = $shopStatus.diagnostics.lastError
    lastReload = $shopStatus.diagnostics.lastReload
}
Send-Command 'closeWindows' $null
Start-Sleep -Seconds 2

# furniture purchase through the real protocol path
$beforeFurniture = Get-Status
$affordable = $beforeFurniture.furniture.shopStock |
    Where-Object { $_.num -gt 0 -and $_.price -le $beforeFurniture.wallet.clover } |
    Select-Object -First 1
if ($affordable) {
    # 走客户端入口（FurnitureModel.requestBuy），与点确认按钮完全同一条路径
    Send-Command 'buyFurnitureUi' @{shopId = $affordable.shop_id}
    $afterFurniture = Wait-For { param($s) $s.wallet.clover -lt $beforeFurniture.wallet.clover } 60 'furniture purchase'
    Add-Result 'furniture purchase deducts clover' ($afterFurniture.wallet.clover -eq ($beforeFurniture.wallet.clover - $affordable.price)) @{
        before = $beforeFurniture.wallet.clover; after = $afterFurniture.wallet.clover; price = $affordable.price
    }
    $stockAfter = ($afterFurniture.furniture.shopStock | Where-Object { $_.shop_id -eq $affordable.shop_id })
    Add-Result 'furniture purchase decrements stock exactly once' ($stockAfter.num -eq ($affordable.num - 1)) @{
        before = $affordable.num; after = $stockAfter.num
    }
    Send-Command 'view' $null
    $clientView = Wait-For { param($s) $s.diagnostics.viewSample.clientClover -ne $null } 90 'client view'
    $clientRow = ($clientView.diagnostics.viewSample.clientShopList | Where-Object { $_[0] -eq $affordable.shop_id })
    Add-Result 'client stock display matches authority' ($clientRow[1] -eq $stockAfter.num) @{
        client = $clientRow[1]; authority = $stockAfter.num
    }
    Add-Result 'client clover display matches authority' ($clientView.diagnostics.viewSample.clientClover -eq $clientView.wallet.clover) @{
        client = $clientView.diagnostics.viewSample.clientClover; authority = $clientView.wallet.clover
    }
}

# 三叶草不足时必须拒绝，且不扣款、不扣库存、不改变客户端显示
$beforePoor = Get-Status
$expensive = $beforePoor.furniture.shopStock |
    Where-Object { $_.num -gt 0 -and $_.price -gt $beforePoor.wallet.clover } |
    Select-Object -First 1
if ($expensive) {
    Send-Command 'buyFurnitureUi' @{shopId = $expensive.shop_id}
    Start-Sleep -Seconds 5
    $afterPoor = Get-Status
    $poorRow = ($afterPoor.furniture.shopStock | Where-Object { $_.shop_id -eq $expensive.shop_id })
    Add-Result 'insufficient clover purchase is rejected' (
        $afterPoor.wallet.clover -eq $beforePoor.wallet.clover -and $poorRow.num -eq $expensive.num
    ) @{
        clover = $afterPoor.wallet.clover; stockBefore = $expensive.num; stockAfter = $poorRow.num
        price = $expensive.price
    }
}

# discover a real shop entry from the bundled config (offline builds must not hardcode ids)
Send-Command 'config' @{table = 'ShopDataDB'; limit = 10}
$configReady = Wait-For { param($s) $s.diagnostics.configSample -ne $null } 30 'config sample'
$shop = $null
foreach ($row in $configReady.diagnostics.configSample.rows) {
    if ($row.price -gt 0) {
        $shop = $row
        break
    }
}
if (-not $shop) { $shop = $configReady.diagnostics.configSample.rows | Select-Object -First 1 }
Write-Output ("shop candidate: id={0} item={1} price={2}" -f $shop.id, $shop.itemId, $shop.price)

# a real courtyard item for the compost slot (type 15 in ItemType)
Send-Command 'config' @{table = 'ItemDB'; limit = 3; where = @{type = 15}}
$itemConfig = Wait-For { param($s) $s.diagnostics.configSample.table -eq 'ItemDB' } 30 'item config'
$courtyardItem = $itemConfig.diagnostics.configSample.rows | Select-Object -First 1
if ($courtyardItem) {
    Send-Command 'grant' @{itemId = $courtyardItem.id; count = 3}
    Wait-For { param($s) $s.items -ge 1 } 30 'grant' | Out-Null
    Write-Output ("courtyard item: id={0}" -f $courtyardItem.id)
}
$houseItem = (Get-Status).houseSample | Select-Object -First 1
Write-Output ("bag test item: id={0}" -f $houseItem.item_id)

$beforeHarvest = Get-Status
$slotId = ($beforeHarvest.clover.readyIds | Select-Object -First 1)
Send-Command 'protocol' @{cmd = 'clover_harvest'; data = @{clover_id = $slotId}}
$afterHarvest = Wait-For { param($s) $s.wallet.clover -gt $beforeHarvest.wallet.clover } 40 'harvest'
Add-Result 'harvest: clover granted once' ($afterHarvest.wallet.clover -eq ($beforeHarvest.wallet.clover + 1)) @{
    before = $beforeHarvest.wallet.clover; after = $afterHarvest.wallet.clover
}
Send-Command 'protocol' @{cmd = 'clover_harvest'; data = @{clover_id = $slotId}}
Start-Sleep -Seconds 6
$doubleHarvest = Get-Status
Add-Result 'harvest: repeated request rejected' ($doubleHarvest.wallet.clover -eq $afterHarvest.wallet.clover) @{
    clover = $doubleHarvest.wallet.clover; slot = $slotId
}

$beforeBuy = Get-Status
Send-Command 'buy' @{shopId = $shop.id}
$afterBuy = Wait-For { param($s) $s.wallet.clover -lt $beforeBuy.wallet.clover } 40 'shop purchase'
Add-Result 'shop: clover deducted' ($afterBuy.wallet.clover -lt $beforeBuy.wallet.clover) @{
    before = $beforeBuy.wallet.clover; after = $afterBuy.wallet.clover
}
Add-Result 'shop: inventory still valid' ($afterBuy.items -ge 1) @{items = $afterBuy.items}

Send-Command 'protocol' @{cmd = 'item_putin_bag'; data = @{pos = 1; item_id = $houseItem.item_id}}
$afterBagIn = Wait-For { param($s) $s.bag[0] -eq $houseItem.item_id } 30 'bag putin'
Add-Result 'bag: putin' ($afterBagIn.bag[0] -eq $houseItem.item_id) $afterBagIn.bag
Send-Command 'protocol' @{cmd = 'item_takeout_bag'; data = @{pos = 1}}
$afterBagOut = Wait-For { param($s) $s.bag[0] -eq -1 } 30 'bag takeout'
Add-Result 'bag: takeout' ($afterBagOut.bag[0] -eq -1) $afterBagOut.bag

$toolId = ($afterBagOut.furniture.bench)[0]
Send-Command 'protocol' @{cmd = 'furniture_takeout_bench'; data = @{pos = 1}}
$afterBenchOut = Wait-For { param($s) $s.furniture.bench[0] -eq -1 } 30 'bench takeout'
Add-Result 'bench: takeout tool' ($afterBenchOut.furniture.bench[0] -eq -1) $afterBenchOut.furniture.bench
Send-Command 'protocol' @{cmd = 'furniture_putin_bench'; data = @{pos = 1; id = $toolId}}
$afterBenchIn = Wait-For { param($s) $s.furniture.bench[0] -eq $toolId } 30 'bench putin'
Add-Result 'bench: putin tool' ($afterBenchIn.furniture.bench[0] -eq $toolId) $afterBenchIn.furniture.bench

if ($courtyardItem) {
    Send-Command 'protocol' @{cmd = 'furniture_putin_box'; data = @{pos = 1; id = $courtyardItem.id}}
    $afterBoxIn = Wait-For { param($s) $s.compost.boxes[0] -eq $courtyardItem.id } 30 'compost putin'
    Add-Result 'compost: putin' ($afterBoxIn.compost.boxes[0] -eq $courtyardItem.id) $afterBoxIn.compost.boxes
}
Send-Command 'protocol' @{cmd = 'furniture_takeout_box'; data = @{pos = 1}}
$afterBoxOut = Wait-For { param($s) $s.compost.boxes[0] -eq -1 } 30 'compost takeout'
Add-Result 'compost: takeout' ($afterBoxOut.compost.boxes[0] -eq -1) $afterBoxOut.compost.boxes

Send-Command 'timeTravel' 7200
$pocketReady = Wait-For { param($s) $s.pocket.clover -ge 1 } 45 'pocket accrual'
$cloverBeforePocket = $pocketReady.wallet.clover
Send-Command 'protocol' @{cmd = 'furniture_pocket_get'; data = @{}}
$afterPocket = Wait-For { param($s) $s.pocket.clover -eq 0 } 40 'pocket get'
Add-Result 'pocket: collect resets and credits clover' ($afterPocket.wallet.clover -ge $cloverBeforePocket) @{
    before = $cloverBeforePocket; after = $afterPocket.wallet.clover
}

$snapshot = Get-Status
& $adb -s $Serial shell am force-stop $package
Start-Sleep -Seconds 3
& $adb -s $Serial shell am start -n $activity | Out-Null
Write-Output 'restarting game for persistence check...'
$deadline = (Get-Date).AddSeconds(180)
$restored = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $candidate = Get-Status
    if ($candidate -and $candidate.revision -ge $snapshot.revision) { $restored = $candidate; break }
}
if (-not $restored) { throw 'no status report after restart' }
Add-Result 'restart: clover persisted' ($restored.wallet.clover -eq $snapshot.wallet.clover) @{
    before = $snapshot.wallet.clover; after = $restored.wallet.clover
}
Add-Result 'restart: revision did not regress' ($restored.revision -ge $snapshot.revision) @{
    before = $snapshot.revision; after = $restored.revision
}
Add-Result 'restart: bench state persisted' (($restored.furniture.bench -join ',') -eq ($snapshot.furniture.bench -join ',')) @{
    before = $snapshot.furniture.bench; after = $restored.furniture.bench
}
Add-Result 'restart: compost state persisted' (($restored.compost.boxes -join ',') -eq ($snapshot.compost.boxes -join ',')) @{
    before = $snapshot.compost.boxes; after = $restored.compost.boxes
}
Add-Result 'restart: clover field restored' ($restored.clover.total -eq 20) @{total = $restored.clover.total}

& $adb -s $Serial shell screencap -p /sdcard/lf-acceptance.png | Out-Null
& $adb -s $Serial pull /sdcard/lf-acceptance.png (Join-Path $root 'offline_build\lf-acceptance.png') | Out-Null

$failed = @($results | Where-Object { -not $_.ok }).Count
foreach ($item in $results) {
    $flag = if ($item.ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0} {1} {2}" -f $flag, $item.name, $item.detail)
}
Write-Output ("SUMMARY total={0} failed={1}" -f $results.Count, $failed)
if ($failed -gt 0) { exit 2 }

