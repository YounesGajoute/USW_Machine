# Version 2 centring Nano firmware image

Saved **PlatformIO build** of the Version 2 centring slave. Use it to flash the centring Nano without rebuilding, or to verify what is on the chip.

| Item | Value |
|------|-------|
| File | `centring-nano-v2-flash.hex` |
| Format | Intel HEX, ends with `:00000001FF` |
| Size | 82,314 bytes (file); 29,262 bytes application flash used (95.3% of 30,720 B) |
| SHA-256 | `a4e2a9ae274964cbdc229de5aa2d8d2d1f53e85652a523acded8767264c28744` (also in `SHA256SUMS`) |
| Source | `pio run -e double_actuator_centring_slave` at git `c74ab18` on branch `version-2` |
| Board | Arduino Nano, ATmega328P, ENC28J60, TCP `192.168.10.55:8177` |

**Version 1 rollback** remains [`../version-1/centring-nano-v1-flash.hex`](../version-1/README.md). Do not flash Version 1 while the host runs the Version 2 cycle.

## Check the image

From the repo root:

```bash
cd Double_Actuator_Centring_Slave_Firmware/images/version-2
sha256sum -c SHA256SUMS
cd -
```

## Flash

Machine idle; hands clear of the jaws. The centring Nano serial symlink is `/dev/centring` (see `platformio.ini`). If it is missing, use `ls -l /dev/serial/by-path/` and do not flash another board.

```bash
AVRDUDE=~/.platformio/packages/tool-avrdude
"$AVRDUDE/bin/avrdude" -C "$AVRDUDE/avrdude.conf" \
  -p atmega328p -c arduino -P /dev/centring -b 115200 -D \
  -U flash:w:Double_Actuator_Centring_Slave_Firmware/images/version-2/centring-nano-v2-flash.hex:i
```

Verify only (read back against this file):

```bash
"$AVRDUDE/bin/avrdude" -C "$AVRDUDE/avrdude.conf" \
  -p atmega328p -c arduino -P /dev/centring -b 115200 \
  -U flash:v:Double_Actuator_Centring_Slave_Firmware/images/version-2/centring-nano-v2-flash.hex:i
```

Then probe TCP from the backend (`npm run centring:check-tcp`). Calibration lives in RAM on the Nano; the host reapplies `slaveCal` after connect.

## Rebuild this image

When firmware source changes on `version-2`:

```bash
cd Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
cp .pio/build/double_actuator_centring_slave/firmware.hex images/version-2/centring-nano-v2-flash.hex
cd images/version-2 && sha256sum centring-nano-v2-flash.hex > SHA256SUMS
```

Commit the updated hex and `SHA256SUMS` with the firmware change.
