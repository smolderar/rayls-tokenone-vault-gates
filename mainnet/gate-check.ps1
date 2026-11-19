# Mainnet gate check (Part A of W3-PLAN.md): who can enter TokenOne's pilot vault on the Rayls Public Chain.
# Read-only: eth_call and eth_getLogs at ONE fixed block. Nothing is signed or sent.
# Output: gate-run-<UTC time>-block<N>.txt and .json next to this script.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$rpc = 'https://mainnet-rpc.rayls.com'

$vault    = '0x1811630b90e6966573e809270a5e9316a25de6fe'   # Lagoon vault RLSTKONE02
$fund     = '0x870c2c4cfaf895f55163385813164e5808ae7029'   # TokenOne fund TKONE02 (RwaVaultV3)
$brl      = '0xa069d3798feab32994ac5d98a9f011da6024f334'   # BRL1.p
$outsider = '0xe892bf4cf5427254a0d5c410785948137b65bf47'   # W3 Outsider (test wallet)
$startBlock = 14731249                                      # block of the vault's first log (18 Nov 2026 11:24:12 UTC)
$tWhitelist = '0xf93f9a76c1bf3444d22400a00cb9fe990e6abe9dbb333fda48859cfee864543d'  # WhitelistUpdated(address,bool)
$tSettle    = '0x26be8b1af887e484fec2868840869fd162e136268c24803bede886ab91aa29bc'  # SettleDeposit(uint40,uint40,uint256,uint256,uint256,uint256)
$errs = @{ '51ee5ed5'='AddressNotAllowed'; 'fb8f41b2'='ERC20InsufficientAllowance'; 'e450d38c'='ERC20InsufficientBalance'; 'd93c0665'='EnforcedPause' }

$lines = New-Object System.Collections.Generic.List[string]
$json = [ordered]@{}
function Say($s) { $lines.Add($s); Write-Host $s }
function F($fmt) { [string]::Format($inv, $fmt, $args) }
function Rpc($m, $p) {
    $b = @{ jsonrpc = '2.0'; id = 1; method = $m; params = $p } | ConvertTo-Json -Depth 8 -Compress
    for ($i = 0; $i -lt 4; $i++) {
        try { return Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 60 }
        catch { if ($i -eq 3) { throw }; Start-Sleep -Seconds 2 }
    }
}
function Pad($a) { ($a -replace '^0x', '').ToLower().PadLeft(64, '0') }
function U($h) { $x = ($h -replace '^0x', ''); if ($x -eq '') { return [System.Numerics.BigInteger]::Zero }; [System.Numerics.BigInteger]::Parse('0' + $x, 'AllowHexSpecifier') }
function Wd($h, $i) { $x = ($h -replace '^0x', ''); if ($x.Length -lt (64 * ($i + 1))) { return '' }; $x.Substring(64 * $i, 64) }
function Short($a) { if (-not $a) { return '-' }; $x = ($a -replace '^0x', '').ToLower(); if ($x.Length -lt 8) { return $a }; '0x' + $x.Substring(0, 4) + '...' + $x.Substring($x.Length - 4) }
function Tf($v) { if ($null -eq $v) { return 'read failed' }; if ($v) { return 'true' }; return 'false' }
function Utc($sec) { [DateTimeOffset]::FromUnixTimeSeconds([long]$sec).UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss', $inv) }
function Units($v, $dec) {
    if ($null -eq $v) { return 'read failed' }
    $s = ([System.Numerics.BigInteger]$v).ToString($inv).PadLeft($dec + 1, '0')
    $i = $s.Substring(0, $s.Length - $dec); $f = $s.Substring($s.Length - $dec)
    $g = [System.Numerics.BigInteger]::Parse($i, $inv).ToString('N0', $inv)
    if ($dec -gt 6) { $f = $f.Substring(0, 6) }
    return $g + '.' + $f
}

$bn = U (Rpc 'eth_blockNumber' @()).result
$bt = '0x' + $bn.ToString('x').TrimStart('0')
$blk = (Rpc 'eth_getBlockByNumber' @($bt, $false)).result
$blockTime = Utc (U $blk.timestamp)
function Call($to, $data, $from) { $tx = @{ to = $to; data = $data }; if ($from) { $tx.from = $from }; Rpc 'eth_call' @($tx, $bt) }
function RevertOf($r) {
    if (-not $r.error) { return $null }
    $d = ''; if ($r.error.data -is [string]) { $d = $r.error.data } elseif ($r.error.data.data) { $d = [string]$r.error.data.data }
    $s = ($d -replace '^0x', '').ToLower()
    if ($s.Length -lt 8) { return @{ name = 'reverted without data'; selector = ''; arg = '' } }
    $sel = $s.Substring(0, 8); $n = $errs[$sel]; if (-not $n) { $n = 'unknown error' }
    $arg = ''; if ($s.Length -ge 72) { $arg = '0x' + $s.Substring(8 + 24, 40) }
    return @{ name = $n; selector = '0x' + $sel; arg = $arg }
}
function ReadU($to, $data) { $r = Call $to $data; if ($r.error) { return $null }; U $r.result }
function ReadB($to, $data) { $v = ReadU $to $data; if ($null -eq $v) { return $null }; return ($v -ne 0) }
function ReadA($to, $data) { $r = Call $to $data; if ($r.error) { return $null }; '0x' + (Wd $r.result 0).Substring(24) }
function ReadS($to, $data) { $r = Call $to $data; if ($r.error) { return '' }; $x = ($r.result -replace '^0x', ''); $len = [int](U (Wd $r.result 1)); $hex = $x.Substring(128, $len * 2); $bytes = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }; [Text.Encoding]::UTF8.GetString([byte[]]$bytes) }
function GetLogs($topic) {
    $all = @(); $from = $startBlock; $step = 50000
    while ($from -le [long]$bn) {
        $to = [Math]::Min([long]$bn, $from + $step - 1)
        $r = $null
        try { $r = Rpc 'eth_getLogs' @(@{ address = $vault; topics = @($topic); fromBlock = ('0x' + ([long]$from).ToString('x')); toBlock = ('0x' + ([long]$to).ToString('x')) }) } catch { $r = @{ error = @{ message = $_.Exception.Message } } }
        if ($r.error) { if ($step -le 500) { throw ('eth_getLogs failed: ' + $r.error.message) }; $step = [int]($step / 2); continue }
        $all += @($r.result); $from = $to + 1
    }
    return $all
}

Clear-Host
Say (F 'Lagoon vault RLSTKONE02 gate check | Rayls Public Chain mainnet | read-only')
Say (F 'Block {0:N0} | block time {1} UTC | every call reads this block' ([long]$bn) $blockTime)
Say (F 'Run started {0} UTC' ([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss', $inv)))
$json.block = [long]$bn; $json.blockTimeUtc = $blockTime

# whitelist history (to the run block) and the control wallet rule
$wl = GetLogs $tWhitelist | Sort-Object { [long](U $_.blockNumber) }, { [long](U $_.logIndex) }
$order = New-Object System.Collections.Generic.List[string]
$adds = 0; $removes = 0; $times = @{}
foreach ($l in $wl) {
    $acct = '0x' + ($l.topics[1] -replace '^0x', '').Substring(24)
    $on = (U $l.data) -ne 0
    if ($on) { $adds++; if (-not $order.Contains($acct)) { $order.Add($acct) } } else { $removes++ }
    $b = [long](U $l.blockNumber); if (-not $times.ContainsKey($b)) { $times[$b] = Utc (U (Rpc 'eth_getBlockByNumber' @(('0x' + $b.ToString('x')), $false)).result.timestamp) }
}
$control = $null
foreach ($a in $order) { if (ReadB $vault ('0xbabcc539' + (Pad $a))) { $control = $a; break } }

Say ''
Say 'ENTRY GATE (simulated requestDeposit of 1 wei BRL1.p, owner = controller = sender)'
$outAllowed = ReadB $vault ('0xbabcc539' + (Pad $outsider))
$req = '0x85b77f45' + ('1'.PadLeft(64, '0'))
$rOut = RevertOf (Call $vault ($req + (Pad $outsider) + (Pad $outsider)) $outsider)
Say (F '  A1 W3 Outsider {0}: isAllowed = {1}' (Short $outsider) (Tf $outAllowed))
if ($rOut) { Say (F '  A2 W3 Outsider request: REVERTS {0} ({1}), address in the error {2}' $rOut.name $rOut.selector (Short $rOut.arg)) } else { Say '  A2 W3 Outsider request: would succeed' }
$json.A1_outsiderIsAllowed = $outAllowed; $json.A2_outsiderRequest = $(if ($rOut) { $rOut.name } else { 'success' })
if ($control) {
    $rCtl = RevertOf (Call $vault ($req + (Pad $control) + (Pad $control)) $control)
    Say (F '  A3 control wallet {0} (first whitelisted address still allowed): isAllowed = true' (Short $control))
    if ($rCtl) { Say (F '  A4 control wallet request: passes the gate, then REVERTS {0} ({1})' $rCtl.name $rCtl.selector) } else { Say '  A4 control wallet request: passes the gate, simulation would succeed' }
    $json.A3_control = (Short $control); $json.A4_controlRequest = $(if ($rCtl) { $rCtl.name } else { 'success' })
} else { Say '  A3/A4 no whitelisted address is allowed at this block' }

Say ''
Say 'VAULT STATE'
$ver = ReadS $vault '0x54fd4d50'
$paused = ReadB $vault '0x5c975abb'
$ta = ReadU $vault '0x01e1d114'; $ts = ReadU $vault '0x18160ddd'
$pps = ReadU $vault ('0x07a2d13a' + '0de0b6b3a7640000'.PadLeft(64, '0'))
$cap = ReadU $vault '0x23548b8b'
$sm = ReadU $vault '0x5b4b399c'
$modes = @('Both', 'SyncDeposit', 'SyncRedeem', 'None')
$fr = (Call $vault '0x7688c584').result
$rates = @(); for ($i = 0; $i -lt 5; $i++) { $rates += [int](U (Wd $fr $i)) }
$owner = ReadA $vault '0x8da5cb5b'
Say (F '  A5 version {0} | paused {1} | owner {2}' $ver (Tf $paused) (Short $owner))
Say (F '     totalAssets {0} BRL1.p | totalSupply {1} shares | assets per share {2}' (Units $ta 18) (Units $ts 18) (Units $pps 18))
Say (F '     maxCap {0} BRL1.p | syncMode {1} = {2}' (Units $cap 18) ([int]$sm) $modes[[int]$sm])
Say (F '     fee rates (bps): management {0}, performance {1}, entry {2}, exit {3}, haircut {4}' $rates[0] $rates[1] $rates[2] $rates[3] $rates[4])
$json.A5 = [ordered]@{ version = $ver; paused = $paused; totalAssets = $ta.ToString(); totalSupply = $ts.ToString(); assetsPerShare = $pps.ToString(); maxCap = $cap.ToString(); syncMode = $modes[[int]$sm]; feeRatesBps = $rates }

Say ''
Say (F 'WHITELIST HISTORY (WhitelistUpdated, blocks {0:N0} to {1:N0})' $startBlock ([long]$bn))
Say (F '  A6 {0} additions, {1} removals' $adds $removes)
$byTime = @{}
foreach ($l in $wl) { $b = [long](U $l.blockNumber); $k = $times[$b] + ' UTC ' + $(if ((U $l.data) -ne 0) { 'added' } else { 'removed' }); if ($byTime.ContainsKey($k)) { $byTime[$k]++ } else { $byTime[$k] = 1 } }
foreach ($k in ($byTime.Keys | Sort-Object)) { Say (F '     {0} x{1}' $k $byTime[$k]) }
$json.A6 = [ordered]@{ additions = $adds; removals = $removes }

Say ''
Say 'DEPOSIT SETTLEMENTS (SettleDeposit)'
$st = GetLogs $tSettle | Sort-Object { [long](U $_.blockNumber) }
$json.A7 = @()
foreach ($l in $st) {
    $b = [long](U $l.blockNumber)
    $t = Utc (U (Rpc 'eth_getBlockByNumber' @(('0x' + $b.ToString('x')), $false)).result.timestamp)
    $dep = U (Wd $l.data 2)
    Say (F '  A7 {0} UTC | epoch {1} | assets deposited {2} BRL1.p' $t ([long](U $l.topics[1])) (Units $dep 18))
    $json.A7 += [ordered]@{ timeUtc = $t; epoch = [long](U $l.topics[1]); assetsDeposited = $dep.ToString() }
}

Say ''
Say 'MONEY PATH (vault -> its Safe -> TokenOne fund TKONE02)'
$safe = ReadA $vault '0x186f0354'
$safeShares = ReadU $fund ('0x70a08231' + (Pad $safe))
$fTotal = ReadU $fund '0x01e1d114'; $fIdle = ReadU $fund '0xe16b03a3'; $fDep = ReadU $fund '0xb0c660ee'
$fBrl = ReadU $brl ('0x70a08231' + (Pad $fund))
$fPps = ReadU $fund ('0x07a2d13a' + '0de0b6b3a7640000'.PadLeft(64, '0'))
$rep = ReadU $fund '0x0a64cc54'; $age = ReadU $fund '0xc45e0d24'; $dev = ReadU $fund '0x87251ff3'
$sumOk = ($fIdle + $fDep) -eq $fTotal
Say (F '  A8 vault Safe {0} holds {1} TKONE02 shares' (Short $safe) (Units $safeShares 18))
Say (F '     TKONE02 totalAssets {0} = idle {1} + deployedCapital {2}' (Units $fTotal 18) (Units $fIdle 18) (Units $fDep 18))
Say (F '     exact in base units: {0} | BRL1.p held by TKONE02 {1}' $(if ($sumOk) { 'yes' } else { 'NO' }) (Units $fBrl 18))
Say (F '     TKONE02 assets per share {0} | deployedCapital reported at {1} UTC' (Units $fPps 18) (Utc $rep))
Say (F '     report guards: max age {0:N0} s, max change {1:N0} bps per report' ([long]$age) ([long]$dev))
$json.A8 = [ordered]@{ safe = (Short $safe); fundTotalAssets = $fTotal.ToString(); idle = $fIdle.ToString(); deployedCapital = $fDep.ToString(); sumExact = $sumOk; brlHeldByFund = $fBrl.ToString(); reportedAtUtc = (Utc $rep); maxReportAgeS = [long]$age; maxReportDeviationBps = [long]$dev }

Say ''
Say 'Read-only. Nothing was sent, nothing was signed.'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss', $inv)
$base = Join-Path $PSScriptRoot ("gate-run-{0}-block{1}" -f $stamp, $bn)
$lines | Out-File -FilePath ($base + '.txt') -Encoding utf8
$json | ConvertTo-Json -Depth 6 | Out-File -FilePath ($base + '.json') -Encoding utf8
