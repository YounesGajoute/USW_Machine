# Pick & Place Nano — TCP wire protocol (New_version)

Firmware: `src/main.cpp` (PlatformIO / Nano + ENC28J60)  
Master: `master/pick_place_master.js`  
HTTP: Express backend `/api/pick-place/*` or standalone `startPickPlaceApi()`

## Connection

| Parameter | Value |
|-----------|-------|
| Master | TCP client @ 192.168.10.1 |
| Nano | 192.168.10.5:8177 |
| Lines | ASCII, `\n` terminated, max 79 chars |
| Session | Request-response (one socket per command) |

## Commands (10)

`PING` `STATUS` `STOP` `ESTOP` `CLRFAULT` `HOME` `HOMEA` `HOMEB` `MOVEAMM` `MOVEBMM`

Diagnostic (bench): `MOVEAMMT1` `MOVEAMMT2` `SWITCHES`

`MOVEBOTHMM` removed — master sends `MOVEAMM` + `MOVEBMM` for dual-axis absolute moves.

## Homing wire format

| Command | Wire example |
|---------|----------------|
| HOMEA | `HOMEA 0.5 80` |
| HOMEB | `HOMEB 0.8 80` |
| HOME (parallel) | `HOME 0.5 0.8 80` |

Backoff mm: 0.01–50. Speed: mm/s on wire.

## Move wire format

Absolute position mm from home reference:

| Command | Wire example |
|---------|----------------|
| MOVEAMM | `MOVEAMM 10 80` |
| MOVEBMM | `MOVEBMM 12 80` |

Requires `homedA=1` / `homedB=1` respectively.

## STATUS fields

`stepA=` `stepB=` `busy=` `homeSt=` `homedA=` `homedB=` `async=` `fault=` `estop=` `pulseMm=` `enA=` `enB=`

`pulseMm=300` → 0.3 mm/pulse → 10/3 steps/mm.

## DONE format

`DONE <tag> posA=… posB=… homedA=… homedB=… bkA=… bkB=…`

## Errors

| Reply | Meaning |
|-------|---------|
| `ERR MOVEMM` | Invalid move arguments (bad position mm) |
| `ERR <tag> busy` | Async in progress |
| `ERR <tag> fault` | Fault latched |
| `ERR <tag> estop` | E-stop latched |
| `ERR <tag> fail` | Axis not homed |

Recover: `CLRFAULT` then `HOME*`.

## Removed from minimal firmware

`ALMCLR` `SPEED` `ENABLE` `MOVEBOTHMM` — not handled.

## Initialization procedure

Required before production moves (also runs during machine init after pneumatics):

1. **HOMEA** — axis A seeks home limit, backs off to `backoffMmA` (default 0.5 mm)
2. **HOMEB** — axis B seeks home limit, backs off to `backoffMmB` (default 0.8 mm)

Both axes must report `homedA=1` / `homedB=1` and positions within 0.2 mm of configured backoff.

| API | Action |
|-----|--------|
| `POST /api/pick-place/initialize` | Run HOMEA → HOMEB sequence |
| `POST /api/machine/initialize` | Pneumatics + pick-place init (DI0 button) |

Optional body: `{ "backoffA": 0.5, "backoffB": 0.8, "homingSpeed": 80 }`
