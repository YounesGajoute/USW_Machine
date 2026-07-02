# DEPRECATED — Legacy centring controller

**Do not flash for production.**

This folder uses the **legacy dual-Nano** centring design:

- Two separate Nanos at `192.168.10.3` and `192.168.10.4`
- TCP port **8888**
- Protocol: `HOME_A`, `SET_A_GAP_MM`, `SET_B_GAP_MM`, etc. (one TCP connection per module)

This is **not compatible** with the current HMI backend.

## Use instead

| Role | Location |
|------|----------|
| Production firmware (PlatformIO) | [`New_centring_systeme_nano/`](../../New_centring_systeme_nano/) |
| Production firmware (Arduino IDE) | [`arduino/actule_Sketch/centring_controller/`](../actule_Sketch/centring_controller/) |
| Master / backend | [`New_version_centring_systeme/centring_master.js`](../../New_version_centring_systeme/centring_master.js) |
| Network endpoint | **`192.168.10.55:8177`** |

See also [`docs/NETWORK_COMMUNICATION_ARCHITECTURE.md`](../../docs/NETWORK_COMMUNICATION_ARCHITECTURE.md) and [`HARDWARE_ARCHITECTURE.md`](../../HARDWARE_ARCHITECTURE.md) §3.4.
