# Deep network diagnostic for Centring Nano TCP (192.168.10.55:8177).
#
# Usage:
#   .\scripts\tcp_diagnose.ps1
#   .\scripts\tcp_diagnose.ps1 -Host_ 192.168.10.55 -Port 8177

param(
    [string]$Host_ = $(if ($env:CENTRING_HOST) { $env:CENTRING_HOST } else { "192.168.10.55" }),
    [int]$Port = $(if ($env:CENTRING_PORT) { [int]$env:CENTRING_PORT } else { 8177 })
)

$subnet = "192.168.10"
$ok = 0
$warn = 0
$fail = 0

function Step-Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green;  $script:ok++ }
function Step-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow; $script:warn++ }
function Step-Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red;    $script:fail++ }
function Step-Info($msg) { Write-Host "       $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "=== Centring Nano TCP diagnostic ===" -ForegroundColor Cyan
Write-Host "Target: ${Host_}:${Port}  (firmware: centring_nano, ENC28J60)" -ForegroundColor Cyan
Write-Host ""

# --- 1. Laptop adapters on 192.168.10.x ---
Write-Host "--- 1. Laptop network adapters ---" -ForegroundColor White
$onSubnet = @()
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" } |
    ForEach-Object {
        $ip = $_.IPAddress
        $pfx = $_.PrefixLength
        $ifAlias = (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Name
        if ($ip -like "$subnet.*") {
            $onSubnet += $ip
            Step-Ok "Adapter '$ifAlias' has $ip/$pfx (correct subnet)"
        } else {
            Step-Info "Adapter '$ifAlias' has $ip/$pfx (not $subnet.0/24)"
        }
    }

if ($onSubnet.Count -eq 0) {
    Step-Fail "No laptop adapter on ${subnet}.0/24"
    Step-Info "Fix: set Ethernet adapter to static IP, e.g. ${subnet}.100 mask 255.255.255.0"
    Step-Info "Settings -> Network -> Ethernet -> Edit IP -> Manual"
    Step-Info "Or (Admin PowerShell):"
    Step-Info "  netsh interface ip set address name=`"Ethernet`" static ${subnet}.100 255.255.255.0"
} else {
    Step-Ok "Laptop can route to Nano subnet"
}

# --- 2. USB vs Ethernet ---
Write-Host ""
Write-Host "--- 2. Physical connection (most common issue) ---" -ForegroundColor White
Step-Info "USB cable (COM4) = flash/upload ONLY. TCP uses ENC28J60 Ethernet."
Step-Info "Required: Ethernet cable from laptop (or switch) to Nano ENC28J60 jack."
Step-Info "RGB on Nano: MAGENTA = no Ethernet link | GREEN = link OK, ready"

# --- 3. Ping (ICMP optional) ---
Write-Host ""
Write-Host "--- 3. Ping (ICMP - optional, often blocked) ---" -ForegroundColor White
$pingOk = Test-Connection -ComputerName $Host_ -Count 2 -Quiet -ErrorAction SilentlyContinue
if ($pingOk) {
    Step-Ok "ping $Host_ replies"
} else {
    Step-Warn "ping $Host_ failed (ICMP blocked is OK if TCP works)"
}

# --- 4. ARP / layer-2 hint ---
Write-Host ""
Write-Host "--- 4. ARP (is Nano on the wire?) ---" -ForegroundColor White
if ($onSubnet.Count -gt 0) {
    $null = ping $Host_ -n 1 -w 500 2>$null
    Start-Sleep -Milliseconds 300
    $arp = arp -a | Select-String $Host_
    if ($arp) {
        Step-Ok "ARP entry for $Host_ : $($arp.Line.Trim())"
    } else {
        Step-Fail "No ARP entry for $Host_ - no layer-2 reply"
        Step-Info "Check: ENC28J60 wiring, cable, link LED, Nano powered, correct subnet"
    }
} else {
    Step-Warn "Skipped ARP (laptop not on ${subnet}.0/24)"
}

# --- 5. TCP connect (real test) ---
Write-Host ""
Write-Host "--- 5. TCP connect to port $Port ---" -ForegroundColor White
$tcpOk = $false
$tcpErr = ""
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($Host_, $Port, $null, $null)
    $wait = $iar.AsyncWaitHandle.WaitOne(4000, $false)
    if (-not $wait) {
        $client.Close()
        throw "timeout after 4 s"
    }
    $client.EndConnect($iar)
    $tcpOk = $true
    $client.Close()
} catch {
    $tcpErr = $_.Exception.Message
}

if ($tcpOk) {
    Step-Ok "TCP ${Host_}:${Port} accepts connections"
} else {
    Step-Fail "TCP ${Host_}:${Port} not reachable ($tcpErr)"
}

# --- 6. PING wire command ---
Write-Host ""
Write-Host "--- 6. Firmware PING command ---" -ForegroundColor White
if ($tcpOk) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient($Host_, $Port)
        $s = $c.GetStream()
        $b = [Text.Encoding]::ASCII.GetBytes("PING`n")
        $s.Write($b, 0, $b.Length)
        $r = New-Object byte[] 64
        $s.ReadTimeout = 3000
        $n = $s.Read($r, 0, $r.Length)
        $reply = [Text.Encoding]::ASCII.GetString($r, 0, $n).Trim()
        $c.Close()
        if ($reply -eq "PONG") {
            Step-Ok "Wire PING -> PONG (firmware OK)"
        } else {
            Step-Warn "TCP connected but reply was: '$reply'"
        }
    } catch {
        Step-Warn "TCP open but PING failed: $($_.Exception.Message)"
    }
} else {
    Step-Warn "Skipped wire PING (no TCP)"
}

# --- 7. Firmware build checklist ---
Write-Host ""
Write-Host "--- 7. Firmware checklist ---" -ForegroundColor White
Step-Info "Must flash centring_nano (NOT centring_nano_motor):"
Step-Info "  py -m platformio run -e centring_nano -t upload"
Step-Info "centring_nano_motor disables Ethernet (ETH_ONLY vs MOTOR_ONLY)"
Step-Info "Wrong IP firmware (pick-place .5) will not answer on .55"

# --- 8. Fix tree ---
Write-Host ""
Write-Host "--- Fix order if TCP fails ---" -ForegroundColor White
$fixes = @(
    "1. Ethernet cable: laptop/switch <-> ENC28J60 (not USB alone)",
    "2. Laptop IP on ${subnet}.x (e.g. ${subnet}.100 / 255.255.255.0)",
    "3. Nano powered; RGB not stuck MAGENTA (no link)",
    "4. Flash: py -m platformio run -e centring_nano -t upload",
    "5. Disable VPN; use wired Ethernet adapter (not Wi-Fi on other subnet)",
    "6. If via bot switch: bot gateway ${subnet}.1, same VLAN as Nano",
    "7. Re-run: .\scripts\tcp_diagnose.ps1"
)
foreach ($f in $fixes) { Step-Info $f }

Write-Host ""
Write-Host "=== Summary: $ok OK, $warn WARN, $fail FAIL ===" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host ""
exit $(if ($fail -eq 0) { 0 } else { 1 })
