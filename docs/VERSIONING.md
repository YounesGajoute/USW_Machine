# Version 1 vs Version 2 (centring development)

| | **Version 1** | **Version 2** |
|---|----------------|----------------|
| **Purpose** | Stable baseline — production + host centring as released | All ongoing **centring** upgrades (host + Nano slave `192.168.10.55`) |
| **Git tag** | `v1.0.0` | `v2.0.0-dev.*` (pre-releases on `version-2`) |
| **Branch** | `main` (matches `v1.0.0` until Version 2 is merged) | `version-2` |
| **GitHub release** | [Version 1](https://github.com/YounesGajoute/USW_Machine/releases/tag/v1.0.0) | Version 2 (pre-release, latest dev tag) |

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

Your machine / Pi can also match Version 1:

```bash
git checkout main
git pull origin main
git checkout v1.0.0   # detached HEAD at stable release
```

## Promote Version 2 to stable (when ready)

1. Merge `version-2` → `main` via PR on GitHub.
2. Tag `v1.1.0` or `v2.0.0` on `main` and create a new **Version 1** release (or rename policy as you prefer).
3. Reset `version-2` from the new `main` for the next centring cycle.

## Centring Nano (slave)

- Firmware tree: `Double_Actuator_Centring_Slave_Firmware/`
- Default TCP: **192.168.10.55:8177**
- Flash/build only from commits on `version-2` while centring logic is in development.
