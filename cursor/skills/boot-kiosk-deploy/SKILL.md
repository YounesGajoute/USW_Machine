---
name: boot-kiosk-deploy
description: >-
  Change or verify production boot: systemd units, Plymouth splash, Chromium
  kiosk, and power-loss survival. Use when editing boot-setup-bundle, plymouth
  install scripts, kiosk launchers, or display/backend service units.
---

# Boot / kiosk deploy

## Purpose

Plants boot via systemd + kiosk browser + splash — not `start.sh`. App-only fixes often regress after power loss. Treat boot packaging as production software.

## Read first

1. `docs/BOOT_STARTUP_CORRECTIONS_AGENT_PROMPT.md`
2. `.cursor/rules/raspberrypi.mdc`
3. Bundle / unit templates listed below

## Source of truth

| Piece | Path |
|-------|------|
| Deployable bundle | `boot-setup-bundle/` + `boot-setup-bundle/apply.sh` |
| Plymouth + stack install | `scripts/plymouth/install-techmac-boot.sh` |
| Service templates | `scripts/plymouth/us-machine-*.service.in` |
| Kiosk (labwc/Chromium) | `scripts/kiosk/` |
| HDMI / Chromium launch | `frontend/scripts/launch-display-hdmi.sh` |
| Display unit | `frontend/scripts/display-chromium.service` |
| Backend service helper | `backend/scripts/install-service.sh` |
| Dev-only | `start.sh` — **not** production boot |

## Workflow

```
Progress:
- [ ] 1. Identify which layer: plymouth | backend unit | frontend/static | kiosk browser
- [ ] 2. Edit templates in repo; apply via bundle/install scripts (not one-off /etc edits only)
- [ ] 3. Preserve ordered dependencies (network/fieldbus prep → API → HMI → kiosk)
- [ ] 4. Graceful shutdown on stop; survive brownouts (restart policies)
- [ ] 5. Keep EtherCAT NIC unmanaged + LAN separate (see fieldbus-bringup)
- [ ] 6. Journal health check after apply
- [ ] 7. Reboot test on target hardware when possible
```

### Forbidden

- Documenting `start.sh` as the plant boot path
- Hardcoding secrets into unit files
- Breaking kiosk into multi-window debug chrome on production images
- Excessive SD-card logging / unrotated journals

## Validation

```bash
# On target after apply (examples):
systemctl status us-machine-backend.service   # actual unit names per install
journalctl -u <unit> -b --no-pager | tail -n 100
# Cold boot: power cycle → splash → API up → kiosk loads HMI
```

## Checklist

- [ ] Units installed from repo templates/bundle
- [ ] Service order documented
- [ ] Kiosk loads HMI without manual login theatre (per site policy)
- [ ] Power-loss restart verified or explicitly deferred with risk note
