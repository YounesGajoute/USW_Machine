# GitHub — repository and workflow

## Repository

| Item | Value |
|------|--------|
| **Remote** | `git@github.com:YounesGajoute/USW_Machine.git` |
| **Web** | https://github.com/YounesGajoute/USW_Machine |
| **Default stable branch** | `main` (tracks **Version 1** until Version 2 is merged) |
| **Centring development branch** | `version-2` |

Do not force-push `main`. Centring experiments belong on `version-2` only.

## Version policy (summary)

| Name | Git tag | Branch | GitHub release | Role |
|------|---------|--------|----------------|------|
| **Version 1** | `v1.0.0` | `main` @ same commit | [Version 1](https://github.com/YounesGajoute/USW_Machine/releases/tag/v1.0.0) | **Stable rollback** — production + host centring as shipped; centring Nano restored from the saved image ([VERSIONING.md](./VERSIONING.md#restore-the-version-1-centring-nano-firmware)) |
| **Version 2** | `v2.0.0-dev.*` | `version-2` | Pre-releases on [Releases](https://github.com/YounesGajoute/USW_Machine/releases) | **Centring development** — host + Nano `192.168.10.55` |

Details: [VERSIONING.md](./VERSIONING.md), modification ledger: [VERSION_2_CENTRING.md](./VERSION_2_CENTRING.md).

## Releases on GitHub

Releases are created from **annotated tags** (`git tag -a …`).

| Tag | Release title | Type |
|-----|---------------|------|
| `v1.0.0` | Version 1 | Latest stable |
| `v2.0.0-dev.1` | Version 2 (development) | Pre-release |
| `v2.0.0-dev.2` | Version 2 (development) | Pre-release (dev bootstrap) |
| `v2.0.0-dev.3` | Version 2 (development) | Pre-release (docs) |
| `v2.0.0-dev.4` | Version 2 (development) | Pre-release (firmware, session, calibration) |

Full history: [RELEASES.md](./RELEASES.md).

### Create a new Version 2 checkpoint

After commits on `version-2`:

```bash
git push origin version-2
git tag -a v2.0.0-dev.N -m "Version 2 checkpoint N — short description"
git push origin v2.0.0-dev.N
gh release create v2.0.0-dev.N \
  --prerelease \
  --title "Version 2 (development)" \
  --target version-2 \
  --notes-file docs/release-notes/v2.0.0-dev.N.md
```

(Create `docs/release-notes/` file first if you want structured notes.)

### Create a new stable Version 1 (after merging Version 2)

```bash
# After PR: version-2 → main
git checkout main && git pull
git tag -a v1.1.0 -m "Version 1 — …"
git push origin v1.1.0
gh release create v1.1.0 --title "Version 1" --notes "…"
```

## Branch workflow

```text
main (Version 1 stable)
  │
  │  v1.0.0 tag ─────────────────────────► rollback baseline
  │
  └── version-2 (all centring dev commits)
         │
         ├── v2.0.0-dev.1, dev.2, …
         └── merge to main when validated → new v1.x tag
```

### Clone and choose line

```bash
git clone git@github.com:YounesGajoute/USW_Machine.git
cd USW_Machine

# Production / stable machine
git checkout main
git pull

# Centring development
git checkout version-2
git pull
./scripts/centring-dev-setup.sh
```

## Pull requests

| From | To | When |
|------|-----|------|
| `version-2` | `main` | Centring + host changes validated on hardware |
| Feature branches | `version-2` | Optional for large slave firmware work |

PR checklist before merge to `main`:

- [ ] `cd backend && npm run test:centring` passes
- [ ] Nano TCP check OK at `192.168.10.55:8177` (or documented bench skip)
- [ ] [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md) and [Centring/Centring.md](./Centring/Centring.md) updated if behaviour changed
- [ ] [VERSION_2_CENTRING.md](./VERSION_2_CENTRING.md) updated with new modifications

## Roll back Version 2 (GitHub + local)

Resets **`version-2`** on GitHub to match **Version 1** files (`v1.0.0`). Does **not** change `main`.

```bash
git fetch origin --tags
git checkout version-2
git reset --hard v1.0.0
git push --force-with-lease origin version-2
```

Optional: delete mistaken pre-release tags on GitHub (`gh release delete v2.0.0-dev.X --yes`).

## Secrets and `.env`

Never commit:

- `backend/.env`, `frontend/.env`
- `backend/data/.session-secret`
- Database files under `backend/data/*.db`

Templates: `backend/.env.example`, `backend/.env.centring-dev` (Version 2 centring defaults).

## Related automation

| Script | Purpose |
|--------|---------|
| `./scripts/centring-dev-setup.sh` | Version 2 bootstrap (deps, tests, firmware build, TCP probe) |
| `backend/npm run test:centring` | Host centring test suite |
| `backend/npm run centring:check-tcp` | Live Nano session check |
