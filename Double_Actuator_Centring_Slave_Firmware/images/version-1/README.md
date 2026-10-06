# Version 1 centring Nano firmware image

Rollback image for the **Version 1 centring system**. Flash it on the centring Nano when the machine goes back to Version 1.

| Item | Value |
|------|-------|
| File | `centring-nano-v1-flash.hex` |
| Format | Intel HEX, ends with `:00000001FF` |
| Size | 77,836 bytes (file); 32,768 bytes of flash |
| SHA-256 | `d62a5e9f0339a55b8d3f5e1ddc9232901209f5141f6a084e68019e18b4f252c6` (also in `SHA256SUMS`) |
| Source | Full flash read-back from the centring Nano on `/dev/ttyUSB2`, 2026-10-06 |
| Content | Application `0x0000`–`0x77FF` (last used byte `0x77CB`), Optiboot bootloader `0x7E00`–`0x7FFF` (115200 baud) |
| Board | Arduino Nano, ATmega328P, ENC28J60, TCP `192.168.10.55:8177` |

**Use this file, not a source build.** A build of tag `v1.0.0` and a build of the current working tree both differ from this image (checked 2026-10-06), so neither reproduces the firmware that ran the Version 1 machine.

Flash, verify, and probe: [docs/VERSIONING.md § Restore the Version 1 centring Nano firmware](../../../docs/VERSIONING.md#restore-the-version-1-centring-nano-firmware).

Limitations:

- The image includes the bootloader region. Through the bootloader that region is not rewritten; the verify step passes only when the Nano already has the same Optiboot (true for the Nano it was read from). On a Nano with a different bootloader, flash through an ISP programmer.
- Calibration values are not in flash (the Nano keeps them in RAM). After flashing, the Version 1 host applies the saved `slaveCal` on connect.
