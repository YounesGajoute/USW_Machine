# Release history

GitHub: https://github.com/YounesGajoute/USW_Machine/releases

## Version 1 (stable)

### v1.0.0 — Version 1

| Field | Value |
|-------|--------|
| **Date** | 2026-10-05 |
| **Commit** | `67827fa` |
| **Branch** | `main` |
| **Release** | https://github.com/YounesGajoute/USW_Machine/releases/tag/v1.0.0 |

**Summary:** Production-ready snapshot including short-tube centring host logic (`L_eff < 55 mm`), vision/HMI updates, centring TCP/master stack, initial slave `actuators.cpp` edits, tests, and centring/production docs.

**Use when:** Running the machine in production, or as the **rollback target** if Version 2 development fails.

**Checkout:**

```bash
git checkout v1.0.0
# or stay on main at this commit until a newer Version 1 tag exists
```

**Centring Nano firmware:** saved image `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex` (77,836 bytes, SHA-256 `d62a5e9f0339a55b8d3f5e1ddc9232901209f5141f6a084e68019e18b4f252c6`), read back from the Version 1 Nano on 2026-10-06. Flash it to roll back: [VERSIONING.md § Restore the Version 1 centring Nano firmware](./VERSIONING.md#restore-the-version-1-centring-nano-firmware). A build of the `v1.0.0` source does not reproduce it.

---

## Version 2 (development — centring)

Pre-releases track branch `version-2`. They include everything in **v1.0.0** plus Version 2–only commits listed below.

### v2.0.0-dev.1

| Field | Value |
|-------|--------|
| **Commit** | `ce49d49` |
| **Adds** | `docs/VERSIONING.md` — Version 1 vs 2 workflow and rollback |

### v2.0.0-dev.2

| Field | Value |
|-------|--------|
| **Commit** | `4f0a557` |
| **Adds** | Centring dev bootstrap (see [VERSION_2_CENTRING.md](./VERSION_2_CENTRING.md#version-2-only-commits-after-v100)) |

### v2.0.0-dev.3

| Field | Value |
|-------|--------|
| **Commit** | `9e6d9b0` |
| **Adds** | GitHub workflow docs, Version 2 targets, and the modification ledger |

### v2.0.0-dev.4

| Field | Value |
|-------|--------|
| **Commit** | tag `v2.0.0-dev.4` on `version-2` |
| **Adds** | Version 2 Nano program, host TCP session recovery, height-calibration HMI, and the saved Version 1 Nano image. Notes: [release-notes/v2.0.0-dev.4.md](./release-notes/v2.0.0-dev.4.md) |

**Latest Version 2 tag:** `v2.0.0-dev.4`.

---

## Superseded

| Tag | Notes |
|-----|--------|
| `v2026.10.05` | Removed; replaced by **Version 1** tag `v1.0.0` |

---

## Naming convention

| Pattern | Meaning |
|---------|---------|
| `v1.x.y` | Stable **Version 1** releases on `main` |
| `v2.0.0-dev.N` | **Version 2** centring development checkpoints on `version-2` |
| `v2.0.0` | (Future) First stable centring-major release after merge policy TBD |
