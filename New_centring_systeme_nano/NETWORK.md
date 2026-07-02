# Centring Nano — Network (static LAN)

Both Nanos share the same subnet and TCP port but **must use different IP and MAC addresses**.

| Device | Role | IP | MAC (last byte) | TCP port |
|--------|------|-----|-----------------|----------|
| Master / bot | TCP client | 192.168.10.1 | — | — |
| Pick & Place Nano | TCP server | **192.168.10.5** | `…:31` | 8177 |
| **Centring Nano** | TCP server | **192.168.10.55** | `…:32` | 8177 |

Firmware: [`src/main.cpp`](src/main.cpp) (`ETH_IP`, `ETH_MAC`).

Master client default: [`master/centring_master.js`](master/centring_master.js) — override with `CENTRING_HOST` / `CENTRING_PORT`.

---

## Two cables — do not confuse them

| Cable | Purpose | Used for TCP? |
|-------|---------|---------------|
| **USB** (COM4) | Flash firmware, `serial_cmd.py` on **motor** build only | **No** on `centring_nano` |
| **Ethernet** (ENC28J60 RJ45) | TCP commands port **8177** | **Yes** |

`centring_nano` (`ETH_ONLY`) has **no USB serial protocol**. If only USB is connected, `tcp_test.ps1` will always fail.

---

## Laptop setup (direct to Nano or via switch)

Set the **Ethernet adapter** that reaches the Nano (not Wi‑Fi on another subnet):

| Setting | Value |
|---------|--------|
| IP | `192.168.10.100` (any free `.2`–`.254`) |
| Mask | `255.255.255.0` |
| Gateway | `192.168.10.1` (optional if direct cable to Nano) |

Windows: Settings → Network & Internet → Ethernet → IP assignment → **Manual**.

Admin PowerShell (adapter name may differ):

```powershell
Get-NetAdapter | Format-Table Name, Status, LinkSpeed
netsh interface ip set address name="Ethernet" static 192.168.10.100 255.255.255.0
```

---

## Flash centring TCP build

```powershell
cd New_centring_systeme_nano
py -m platformio run -e centring_nano -t upload
```

Do **not** flash `centring_nano_motor` for TCP tests (no ENC28J60 server).  
Do **not** flash pick-place firmware (IP `192.168.10.5`).

---

## Verify connectivity

```powershell
# Automated diagnostic (recommended)
.\scripts\tcp_diagnose.ps1

# Or via tcp_test
.\scripts\tcp_test.ps1 -Diagnose

# Manual
ping 192.168.10.55                    # may fail even when TCP works (ICMP blocked)
.\scripts\tcp_test.ps1 -Cmd PING        # real test -> PONG
```

---

## Troubleshooting

### Symptom: `ping failed` + `TCP port 8177 not reachable`

Work through in order:

#### 1. Physical Ethernet (most common)

- [ ] Ethernet cable: **laptop or switch** ↔ **ENC28J60** on Nano board
- [ ] USB alone is **not** enough for TCP
- [ ] Link LED on ENC28J60 / switch port lit
- [ ] **RGB on Nano:** **magenta** = no link → fix cable/wiring; **green** = link OK

ENC28J60 SPI pins (must not be reused): CS **D10**, MOSI **D11**, MISO **D12**, SCK **D13**.

#### 2. Laptop on wrong subnet

- [ ] Laptop has an IPv4 on `192.168.10.x` (check: `Get-NetIPAddress -AddressFamily IPv4`)
- [ ] Not only on Wi‑Fi `192.168.1.x` while testing `.10.55`
- [ ] VPN disabled for test

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" }
```

#### 3. Wrong firmware

- [ ] Flashed **`centring_nano`** (not `centring_nano_motor`)
- [ ] Centring IP is **`.55`** (not pick-place `.5`)

```powershell
py -m platformio run -e centring_nano -t upload
```

#### 4. Nano not on the wire (ARP)

After setting laptop IP and pinging once:

```powershell
arp -a | findstr 192.168.10.55
```

No ARP line → no layer-2 path (cable, ENC28J60 power, wiring, link down).

#### 5. Ping fails but TCP works

Many networks block ICMP. **Ignore ping failure** if:

```powershell
.\scripts\tcp_test.ps1 -Cmd PING
# PONG
```

#### 6. Via production bot network

If Nano is on the bot switch (not direct to laptop):

- Laptop must be on `192.168.10.x` on the **same switch/VLAN**
- Or run TCP tests **from the bot** (`192.168.10.1`), not the office Wi‑Fi

### Symptom: `Test-NetConnection` hangs

Use the project scripts instead (4 s TCP timeout, no hang):

```powershell
.\scripts\tcp_diagnose.ps1
.\scripts\tcp_test.ps1 -Cmd PING
```

### Symptom: `serial_cmd.py` no reply on COM4

Expected if you flashed **`centring_nano`**. Reflash **`centring_nano_motor`** for USB serial bench, or use TCP for production build.

---

## RGB status (Ethernet builds)

| Color | Meaning |
|-------|---------|
| **Magenta** | Ethernet link down — fix cable before TCP |
| Green | Link up, ready |
| Blue | Moving / homing |
| Red | Fault / e-stop / not ready |

---

## Verify from the bot (192.168.10.1)

```powershell
ping 192.168.10.55
Test-NetConnection 192.168.10.55 -Port 8177
```
