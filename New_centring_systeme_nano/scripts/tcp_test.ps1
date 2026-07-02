# Test Centring Nano TCP commands from your laptop.
#
# Usage:
#   .\scripts\tcp_test.ps1              # quick: sync + error checks (no motion)
#   .\scripts\tcp_test.ps1 -Full        # all 15 commands + motion (hardware required)
#   .\scripts\tcp_test.ps1 -Cmd PING      # single command
#   .\scripts\tcp_test.ps1 -Cmd "MOVEBOTHMM 18 45" -TimeoutSec 120
#   .\scripts\tcp_test.ps1 -List
#
# Environment (optional):
#   $env:CENTRING_HOST = "192.168.10.55"
#   $env:CENTRING_PORT = "8177"

param(
    [string]$Host_ = $(if ($env:CENTRING_HOST) { $env:CENTRING_HOST } else { "192.168.10.55" }),
    [int]$Port = $(if ($env:CENTRING_PORT) { [int]$env:CENTRING_PORT } else { 8177 }),
    [string]$Cmd = "",
    [int]$TimeoutSec = 0,
    [switch]$Full,
    [switch]$List,
    [switch]$VerboseReply,
    [switch]$Diagnose,
    [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"

if ($Diagnose) {
    $diag = Join-Path $PSScriptRoot "tcp_diagnose.ps1"
    & $diag -Host_ $Host_ -Port $Port
    exit $LASTEXITCODE
}

function Test-CentringTcpPort {
    param([int]$ConnectMs = 4000)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($Host_, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($ConnectMs, $false)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Show-TcpPreflightFailure {
    Write-Host "FAIL: TCP ${Host_}:${Port} not reachable" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common causes:" -ForegroundColor Yellow
    Write-Host "  1. USB is for flash only - need Ethernet cable to ENC28J60" -ForegroundColor DarkGray
    Write-Host "  2. Laptop not on 192.168.10.x - set e.g. 192.168.10.100 / 255.255.255.0" -ForegroundColor DarkGray
    Write-Host "  3. Nano RGB MAGENTA = no Ethernet link" -ForegroundColor DarkGray
    Write-Host "  4. Wrong firmware - use: py -m platformio run -e centring_nano -t upload" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Run full diagnostic: .\scripts\tcp_test.ps1 -Diagnose" -ForegroundColor Cyan
    Write-Host "See NETWORK.md section 'Troubleshooting'" -ForegroundColor Cyan
}

function Send-CentringTcp {
    param(
        [string]$Line,
        [int]$ReadMs = 5000
    )
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.ReceiveTimeout = $ReadMs
    $tcp.SendTimeout = 5000
    try {
        $tcp.Connect($Host_, $Port)
        $sw = $tcp.GetStream()
        $payload = if ($Line.EndsWith("`n")) { $Line } else { "$Line`n" }
        $bytes = [Text.Encoding]::ASCII.GetBytes($payload)
        $sw.Write($bytes, 0, $bytes.Length)
        $buf = New-Object byte[] 512
        $sb = New-Object System.Text.StringBuilder
        $deadline = [DateTime]::UtcNow.AddMilliseconds($ReadMs)
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($sw.DataAvailable) {
                $n = $sw.Read($buf, 0, $buf.Length)
                if ($n -le 0) { break }
                [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
                if ($sb.ToString() -match "`n") { break }
            } else {
                Start-Sleep -Milliseconds 50
            }
        }
        return $sb.ToString().Trim()
    } finally {
        $tcp.Close()
    }
}

function Invoke-CentringTest {
    param(
        [string]$Name,
        [string]$Wire,
        [string]$ExpectPattern,
        [int]$ReadMs = 5000
    )
    Write-Host ">> $Wire" -ForegroundColor Cyan
    $reply = Send-CentringTcp -Line $Wire -ReadMs $ReadMs
    if ($VerboseReply -or -not $reply) {
        Write-Host "   $($reply -replace "`n", ' | ')" -ForegroundColor DarkGray
    }
    $ok = [bool]($reply -match $ExpectPattern)
    if ($ok) {
        Write-Host "   PASS  $Name" -ForegroundColor Green
    } else {
        Write-Host "   FAIL  $Name  (got: '$reply')" -ForegroundColor Red
    }
    return @{ Ok = $ok; Reply = $reply }
}

$AllCommands = @(
    @{ N = 1;  Name = "PING";           Wire = "PING";                    Sync = $true }
    @{ N = 2;  Name = "STATUS";         Wire = "STATUS";                  Sync = $true }
    @{ N = 3;  Name = "STOP";           Wire = "STOP";                    Sync = $true }
    @{ N = 4;  Name = "ESTOP";          Wire = "ESTOP";                   Sync = $true }
    @{ N = 5;  Name = "CLRFAULT";       Wire = "CLRFAULT";                Sync = $true }
    @{ N = 6;  Name = "SETMECHOFF";     Wire = "SETMECHOFF 0";            Sync = $true }
    @{ N = 7;  Name = "HOME";           Wire = "HOME";                    Sync = $false }
    @{ N = 8;  Name = "HOME_UPPER";     Wire = "HOME_UPPER";              Sync = $false }
    @{ N = 9;  Name = "HOME_LOWER";     Wire = "HOME_LOWER";              Sync = $false }
    @{ N = 10; Name = "SEEK_TRAVEL";    Wire = "SEEK_TRAVEL";             Sync = $false }
    @{ N = 11; Name = "MOVEBOTHMM";     Wire = "MOVEBOTHMM 18 45";        Sync = $false }
    @{ N = 12; Name = "MOVE_UPPERMM";   Wire = "MOVE_UPPERMM 20 45";      Sync = $false }
    @{ N = 13; Name = "MOVE_LOWERMM";   Wire = "MOVE_LOWERMM 20 45";      Sync = $false }
)

if ($List) {
    $AllCommands | ForEach-Object { Write-Host ("{0,2}. {1,-14} {2}" -f $_.N, $_.Name, $_.Wire) }
    exit 0
}

Write-Host "Centring TCP test -> ${Host_}:${Port}" -ForegroundColor Yellow
Write-Host ""

# Connectivity pre-check (ping is optional; TCP connect is the real test)
if (-not $SkipPreflight) {
    $onSubnet = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "192.168.10.*" })
    if ($onSubnet.Count -eq 0) {
        Write-Host "WARN: no laptop adapter on 192.168.10.x - set e.g. 192.168.10.100" -ForegroundColor Yellow
    }
    $ping = Test-Connection -ComputerName $Host_ -Count 1 -Quiet -ErrorAction SilentlyContinue
    if (-not $ping) {
        Write-Host "NOTE: ping $Host_ failed (ICMP often blocked; TCP may still work)" -ForegroundColor DarkYellow
    }
    if (-not (Test-CentringTcpPort)) {
        Show-TcpPreflightFailure
        exit 1
    }
}

if ($Cmd) {
    $ms = if ($TimeoutSec -gt 0) { $TimeoutSec * 1000 } else { 5000 }
    $reply = Send-CentringTcp -Line $Cmd -ReadMs $ms
    Write-Host $reply
    exit 0
}

$pass = 0
$fail = 0

function Record-Result($r) {
    if ($r.Ok) { $script:pass++ } else { $script:fail++ }
}

if (-not $Full) {
    Write-Host "=== Quick TCP test (sync + errors, no motion) ===" -ForegroundColor Yellow
    Write-Host ""

    Record-Result (Invoke-CentringTest "PING" "PING" "^PONG$")
    Record-Result (Invoke-CentringTest "CLRFAULT" "CLRFAULT" "^OK CLRFAULT$")
    Record-Result (Invoke-CentringTest "STATUS fields" "STATUS" "u=.*l=.*h=.*busy=.*homedUpper=.*homedLower=.*hmin=.*hmax=.*mechOff=")
    Record-Result (Invoke-CentringTest "SETMECHOFF 0" "SETMECHOFF 0" "^OK SETMECHOFF$")
    Record-Result (Invoke-CentringTest "SETMECHOFF -2" "SETMECHOFF -2" "^OK SETMECHOFF$")
    Record-Result (Invoke-CentringTest "SETMECHOFF restore" "SETMECHOFF 0" "^OK SETMECHOFF$")
    Record-Result (Invoke-CentringTest "STOP" "STOP" "^(OK STOP|ERR .+ stopped)$")
    Record-Result (Invoke-CentringTest "ESTOP" "ESTOP" "^(OK ESTOP|ERR .+ estop)$")
    Record-Result (Invoke-CentringTest "CLRFAULT after ESTOP" "CLRFAULT" "^OK CLRFAULT$")
    Record-Result (Invoke-CentringTest "ERR UNKNOWN" "FOO" "^ERR UNKNOWN$")

    $s = Send-CentringTcp "STATUS" 5000
    if ($s -match "homedUpper=0") {
        Record-Result (Invoke-CentringTest "SEEK_TRAVEL not_ready" "SEEK_TRAVEL" "^ERR SEEK_TRAVEL not_ready$")
    } else {
        Write-Host ">> SEEK_TRAVEL (skipped not_ready - already homed)" -ForegroundColor DarkYellow
    }
    if ($s -match "homedUpper=1" -and $s -match "homedLower=1") {
        Record-Result (Invoke-CentringTest "h_out_of_range" "MOVEBOTHMM 5 45" "^ERR MOVEBOTHMM h_out_of_range$")
    }

    Write-Host ""
    Write-Host "Quick: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
    Write-Host "For all 15 commands including motion: .\scripts\tcp_test.ps1 -Full" -ForegroundColor DarkGray
    exit $(if ($fail -eq 0) { 0 } else { 1 })
}

Write-Host "=== Full TCP test (all 15 commands - hardware + limits required) ===" -ForegroundColor Yellow
Write-Host "Clear area. Motion will run. Timeout 120 s per async command." -ForegroundColor Yellow
Write-Host ""

$asyncMs = 120000

Record-Result (Invoke-CentringTest "1 PING" "PING" "^PONG$")
Record-Result (Invoke-CentringTest "5 CLRFAULT" "CLRFAULT" "^OK CLRFAULT$")
Record-Result (Invoke-CentringTest "2 STATUS" "STATUS" "u=.*l=.*h=.*busy=.*homedUpper=.*homedLower=")
Record-Result (Invoke-CentringTest "6 SETMECHOFF 0" "SETMECHOFF 0" "^OK SETMECHOFF$")
Record-Result (Invoke-CentringTest "7 HOME" "HOME" "^DONE HOME " $asyncMs)
Record-Result (Invoke-CentringTest "2 STATUS after HOME" "STATUS" "homedUpper=1.*homedLower=1")
Record-Result (Invoke-CentringTest "11 MOVEBOTHMM" "MOVEBOTHMM 18 45" "^DONE MOVEBOTHMM " $asyncMs)
Record-Result (Invoke-CentringTest "12 MOVE_UPPERMM" "MOVE_UPPERMM 20 45" "^DONE MOVE_UPPERMM " $asyncMs)
Record-Result (Invoke-CentringTest "13 MOVE_LOWERMM" "MOVE_LOWERMM 20 45" "^DONE MOVE_LOWERMM " $asyncMs)
Record-Result (Invoke-CentringTest "10 SEEK_TRAVEL" "SEEK_TRAVEL" "^DONE SEEK_TRAVEL " $asyncMs)
Record-Result (Invoke-CentringTest "8 HOME_UPPER" "HOME_UPPER" "^DONE HOME_UPPER " $asyncMs)
Record-Result (Invoke-CentringTest "9 HOME_LOWER" "HOME_LOWER" "^DONE HOME_LOWER " $asyncMs)
Record-Result (Invoke-CentringTest "6 SETMECHOFF -2" "SETMECHOFF -2" "^OK SETMECHOFF$")
Record-Result (Invoke-CentringTest "6 SETMECHOFF 0" "SETMECHOFF 0" "^OK SETMECHOFF$")
Record-Result (Invoke-CentringTest "3 STOP" "STOP" "^OK STOP$")
Record-Result (Invoke-CentringTest "4 ESTOP" "ESTOP" "^OK ESTOP$")
Record-Result (Invoke-CentringTest "5 CLRFAULT" "CLRFAULT" "^OK CLRFAULT$")

Write-Host ""
Write-Host "Full: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
exit $(if ($fail -eq 0) { 0 } else { 1 })
