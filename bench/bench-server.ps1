# Local server for the W3 test bench page (Rayls Testnet, CompliantERC20 rule matrix).
# - Serves index.html from this folder on http://localhost:8765/ (MetaMask does not work on file:// pages).
# - Saves the page's log next to this script: bench-log.json (full state) and bench-records.jsonl (one line per step).
# - Forwards read-only JSON-RPC calls: testnet reads, plus eth_getCode/eth_blockNumber on mainnet for check B0a.
# It holds no keys and cannot sign anything. Every transaction is signed in MetaMask.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$inv     = [System.Globalization.CultureInfo]::InvariantCulture
$root    = $PSScriptRoot
$port    = 8765
$origin  = "http://localhost:$port"
$rpcTest = 'https://testnet-rpc.rayls.com/'
$rpcMain = 'https://mainnet-rpc.rayls.com'
$readTest = @('eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_getLogs')
$readMain = @('eth_chainId', 'eth_blockNumber', 'eth_getCode')
$logFile = Join-Path $root 'bench-log.json'
$recFile = Join-Path $root 'bench-records.jsonl'
$utf8    = New-Object System.Text.UTF8Encoding($false)

function Send-Bytes($ctx, [byte[]]$bytes, [string]$type) {
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = $type
    $ctx.Response.AddHeader('Cache-Control', 'no-store')
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.OutputStream.Close()
}
function Send-Text($ctx, [string]$text, [string]$type) { Send-Bytes $ctx ($utf8.GetBytes($text)) $type }
function Send-Status($ctx, [int]$code) { $ctx.Response.StatusCode = $code; $ctx.Response.Close() }
function Read-Body($ctx) {
    $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, $utf8)
    $body = $reader.ReadToEnd()
    $reader.Close()
    return $body
}
function Rpc-Error([string]$msg) {
    return '{"jsonrpc":"2.0","id":0,"error":{"code":-32000,"message":"' + ($msg -replace '["\\\r\n]', ' ') + '"}}'
}
function Forward-Rpc([string]$url, [string]$body, $allowed) {
    $t = $body.Trim()
    if (-not $t.StartsWith('{')) { return (Rpc-Error 'single requests only') }
    $method = $null
    try { $method = [string](ConvertFrom-Json $t).method } catch { return (Rpc-Error 'request is not valid JSON') }
    if ($allowed -notcontains $method) { return (Rpc-Error ('method not allowed by the local server: ' + $method)) }
    try {
        $r = Invoke-WebRequest -Uri $url -Method Post -ContentType 'application/json' -Body $t -UseBasicParsing -TimeoutSec 30
        return [string]$r.Content
    } catch {
        return (Rpc-Error ('local server could not reach the RPC: ' + $_.Exception.Message))
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("$origin/")
try { $listener.Start() } catch {
    Write-Host ''
    Write-Host "  Could not start the local server on port $port."
    Write-Host ('  ' + $_.Exception.Message)
    Write-Host ''
    Read-Host '  Press Enter to close'
    exit 1
}
Write-Host ''
Write-Host "  Rayls Testnet bench:  $origin/"
Write-Host '  Open it in the browser that has MetaMask. Keep this window open, close it to stop.'
Write-Host ''

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $req  = $ctx.Request
        $path = $req.Url.AbsolutePath
        $from = $req.Headers['Origin']
        $sameOrigin = (-not $from) -or ($from -eq $origin)
        $isJson = ([string]$req.ContentType).StartsWith('application/json')
        if ($req.HttpMethod -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
            Send-Bytes $ctx ([System.IO.File]::ReadAllBytes((Join-Path $root 'index.html'))) 'text/html; charset=utf-8'
        } elseif ($req.HttpMethod -eq 'GET' -and $path -eq '/log') {
            if (Test-Path -LiteralPath $logFile) { Send-Bytes $ctx ([System.IO.File]::ReadAllBytes($logFile)) 'application/json' }
            else { Send-Text $ctx '{}' 'application/json' }
        } elseif ($req.HttpMethod -eq 'POST' -and $sameOrigin -and $isJson) {
            $body = Read-Body $ctx
            if ($path -eq '/rpc') {
                Send-Text $ctx (Forward-Rpc $rpcTest $body $readTest) 'application/json'
            } elseif ($path -eq '/rpc-mainnet') {
                Send-Text $ctx (Forward-Rpc $rpcMain $body $readMain) 'application/json'
            } elseif ($path -eq '/log' -and $body.TrimStart().StartsWith('{')) {
                [System.IO.File]::WriteAllText($logFile, $body, $utf8)
                Send-Text $ctx '{"ok":true}' 'application/json'
            } elseif ($path -eq '/record' -and $body.TrimStart().StartsWith('{')) {
                [System.IO.File]::AppendAllText($recFile, ($body.Trim() + "`n"), $utf8)
                $step = ''
                try { $step = [string](ConvertFrom-Json $body).step } catch { }
                Write-Host ('  ' + [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss', $inv) + ' UTC  saved ' + $step)
                Send-Text $ctx '{"ok":true}' 'application/json'
            } else {
                Send-Status $ctx 404
            }
        } else {
            Send-Status $ctx 404
        }
    } catch {
        try { Send-Status $ctx 500 } catch { }
    }
}
