# Centring development (Version 2)

Work **only** on branch `version-2`. **Version 1** (`v1.0.0` on `main`) is the rollback baseline.

| Item | Value |
|------|--------|
| Branch | `version-2` |
| Stable tag | `v1.0.0` |
| Dev pre-releases | `v2.0.0-dev.*` |
| Slave TCP | `192.168.10.55:8177` |
| Host centring code | `backend/lib/centring*.mjs`, `productionCentringSequence.mjs`, `centringIdle.mjs`, `centringAdvancedGap.mjs` |
| Slave firmware | `Double_Actuator_Centring_Slave_Firmware/` |

**Documentation:**

| Doc | Content |
|-----|---------|
| [VERSION_2_CENTRING.md](../VERSION_2_CENTRING.md) | Version 2 **targets** and **all applied modifications** |
| [GITHUB.md](../GITHUB.md) | GitHub branches, releases, PRs |
| [VERSIONING.md](../VERSIONING.md) | Rollback to Version 1 |
| [Centring.md](./Centring.md) | Production centring behaviour |

## One-time setup

From the repo root on the Pi or dev machine:

```bash
git fetch origin --tags
git checkout version-2
git pull origin version-2
./scripts/centring-dev-setup.sh
```

This will:

- Ensure `backend/.env` exists with `CENTRING_HOST=192.168.10.55` and `CENTRING_PORT=8177`
- Install backend Node dependencies
- Run a **non-destructive** TCP probe to the Nano (if reachable)

## Daily workflow

```bash
git checkout version-2
git pull origin version-2
```

1. **Host changes** — edit `backend/lib/…`, run targeted tests (below), restart API if running.
2. **Slave changes** — edit `Double_Actuator_Centring_Slave_Firmware/src/`, build and upload:

```bash
cd Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
pio run -e double_actuator_centring_slave -t upload
```

3. **Manual TCP** (from firmware tree):

```bash
cd Double_Actuator_Centring_Slave_Firmware
python3 scripts/slave_tcp.py PING
python3 scripts/slave_tcp.py STATUS
./scripts/terminal_test.sh smoke
```

4. **Host session check**:

```bash
cd backend
node scripts/check-centring-tcp-session.mjs
```

## Tests (host)

```bash
cd backend
npm run test:centring
```

Includes centring idle, advanced gap, production centring sequence, and related unit tests.

## Bench env (optional)

Use only when hardware is partial — **not** for production validation on the machine:

```bash
# backend/.env
CENTRING_SKIP_INIT=1              # skip SEEK/HOME on DI0 setup
PRODUCTION_SKIP_CENTRING=1        # skip centring motion in cycle (enqueue gate open)
```

For motion development, keep these **unset** and use the real Nano at `192.168.10.55`.

## Save a dev checkpoint on GitHub

```bash
git add -A && git commit -m "centring: …"
git push origin version-2
git tag -a v2.0.0-dev.N -m "Version 2 checkpoint N"
git push origin v2.0.0-dev.N
gh release create v2.0.0-dev.N --prerelease --title "Version 2 (development)" --target version-2
```

## Roll back all Version 2 work

```bash
git fetch origin --tags
git checkout version-2
git reset --hard v1.0.0
git push --force-with-lease origin version-2
```

On the machine: `git checkout main && git pull` or `git checkout v1.0.0`.
