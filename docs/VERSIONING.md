# Version 1 vs Version 2 (centring development)

**Full documentation:**

- [docs/README.md](./README.md) — index  
- [GITHUB.md](./GITHUB.md) — GitHub workflow and releases  
- [RELEASES.md](./RELEASES.md) — tag history  
- [VERSION_2_CENTRING.md](./VERSION_2_CENTRING.md) — Version 2 mission and **all applied modifications**  
- [Centring/VERSION_2_PHASE_REQUIREMENTS.md](./Centring/VERSION_2_PHASE_REQUIREMENTS.md) — Version 2 centring contract  
- [Centring/DEVELOPMENT.md](./Centring/DEVELOPMENT.md) — daily centring dev  

| | **Version 1** | **Version 2** |
|---|----------------|----------------|
| **Purpose** | Stable baseline — production + Version 1 centring as released | Centring on the host and the Nano slave (`192.168.10.55`): production classes `L_eff` 40–55 / 55–100 mm, rebuilt HOME / TRAVEL steps and orchestration, reused Version 1 height move, height model, recipe, and TCP link |
| **Git tag** | `v1.0.0` | `v2.0.0-dev.*` (pre-releases on `version-2`) |
| **Branch** | `main` (matches `v1.0.0` until Version 2 is merged) | `version-2` |
| **GitHub release** | [Version 1](https://github.com/YounesGajoute/USW_Machine/releases/tag/v1.0.0) | [Version 2 pre-releases](https://github.com/YounesGajoute/USW_Machine/releases) (`v2.0.0-dev.*`) |

## Start centring development

```bash
git fetch origin --tags
git checkout version-2
git pull origin version-2
./scripts/centring-dev-setup.sh
```

Full checklist: **[docs/Centring/DEVELOPMENT.md](Centring/DEVELOPMENT.md)**.

## Daily work (Version 2)

```bash
git fetch origin
git checkout version-2
# … edit centring host (`backend/lib/…`) and/or slave (`Double_Actuator_Centring_Slave_Firmware/`) …
git add -A && git commit -m "…"
git push origin version-2
```

Tag a new dev snapshot when you want a saved checkpoint on GitHub:

```bash
git tag -a v2.0.0-dev.N -m "Version 2 dev checkpoint N"
git push origin v2.0.0-dev.N
gh release create v2.0.0-dev.N --prerelease --title "Version 2 (development)" --target version-2 --notes "…"
```

## Roll back Version 2 — discard all dev changes

This resets the **development branch** to exactly **Version 1** (same files as tag `v1.0.0`). Uncommitted local edits are lost; commit or stash first if you need to keep anything.

```bash
git fetch origin --tags
git checkout version-2
git reset --hard v1.0.0
git push --force-with-lease origin version-2
```

Your machine / Pi can also match Version 1 (then also restore the Nano firmware, [next section](#restore-the-version-1-centring-nano-firmware)):

```bash
git checkout main
git pull origin main
git checkout v1.0.0   # detached HEAD at stable release
```

## Restore the Version 1 centring Nano firmware

Going back to Version 1 needs **both** the Version 1 host software (above) **and** the Version 1 firmware on the centring Nano. The firmware is restored from a saved image, not from a source build.

| Item | Value |
|------|-------|
| Image | [`Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex`](../Double_Actuator_Centring_Slave_Firmware/images/version-1/README.md) |
| Size | 77,836 bytes, Intel HEX ending with `:00000001FF` |
| SHA-256 | `d62a5e9f0339a55b8d3f5e1ddc9232901209f5141f6a084e68019e18b4f252c6` |
| Origin | Full flash read-back of the Version 1 centring Nano (`/dev/ttyUSB2`), 2026-10-06 |

Do **not** use `pio run -e double_actuator_centring_slave -t upload` for this: it flashes whatever source is checked out. Builds of tag `v1.0.0` and of the current tree both differ from the image.

**1. Machine idle.** No production and no centring motion. The servos move when the Nano restarts; keep hands clear of the jaws.

**2. Check the image** (from the repo root):

```bash
cd Double_Actuator_Centring_Slave_Firmware/images/version-1
sha256sum -c SHA256SUMS          # must print: centring-nano-v1-flash.hex: OK
cd -
```

**3. Check the port.** The centring Nano is `/dev/ttyUSB2` (USB location `4-1.4`, see `platformio.ini`). If it is not there, find it with `ls -l /dev/serial/by-path/` before flashing; do not flash another Nano.

**4. Flash** with the avrdude bundled with PlatformIO (writes, then verifies automatically):

```bash
AVRDUDE=~/.platformio/packages/tool-avrdude
"$AVRDUDE/bin/avrdude" -C "$AVRDUDE/avrdude.conf" \
  -p atmega328p -c arduino -P /dev/ttyUSB2 -b 115200 -D \
  -U flash:w:Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex:i
```

Success ends with `… bytes of flash verified` (no `verification error`) and `avrdude done. Thank you.` A verify mismatch means the flash is not the Version 1 image: do not run production; repeat the flash, and if it still fails, see the image README (bootloader limitation).

Verify only, without writing (for example to check which firmware a Nano holds):

```bash
"$AVRDUDE/bin/avrdude" -C "$AVRDUDE/avrdude.conf" \
  -p atmega328p -c arduino -P /dev/ttyUSB2 -b 115200 \
  -U flash:v:Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex:i
```

This also restarts the Nano.

**5. Probe the link:**

```bash
cd backend && npm run centring:check-tcp
```

The Nano must answer on `192.168.10.55:8177`. Calibration is not stored in flash: the Version 1 host applies the saved `slaveCal` when it connects, after which STATUS shows `cal=1`. If the backend does not reconnect by itself, restart it (`sudo systemctl restart us-machine-headless-web.service`, see [APPLICATION_UPDATE_AND_RESTART.md](./APPLICATION_UPDATE_AND_RESTART.md)).

**6. Record** the date, the image SHA-256, and the host commit (`v1.0.0`) in the maintenance log.

## Promote Version 2 to stable (when ready)

1. Merge `version-2` → `main` via PR on GitHub.
2. Tag `v1.1.0` or `v2.0.0` on `main` and create a new **Version 1** release (or rename policy as you prefer).
3. Reset `version-2` from the new `main` for the next centring cycle.

## Centring Nano (slave)

- Firmware tree: `Double_Actuator_Centring_Slave_Firmware/` — **the Version 2 centring firmware source** (branch `version-2`). Uploading from it puts Version 2 on the Nano.
- Default TCP: **192.168.10.55:8177**
- Flash/build only from commits on `version-2` while centring logic is in development.
- Version 1 firmware rollback: flash the saved image `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex` ([procedure](#restore-the-version-1-centring-nano-firmware)), not a source build.
