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

**Latest Version 2 tag:** `v2.0.0-dev.2` (check GitHub Releases for newer `v2.0.0-dev.*`).

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
