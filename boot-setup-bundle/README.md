# Boot setup bundle (TECHMAC Plymouth + auto-start stack)

Everything needed to apply the **TECHMAC Plymouth** theme and the **boot-time application stack** (systemd headless web + LightDM / labwc / Chromium kiosk) on a Raspberry Pi or similar Debian host.

The bundle lives **inside** the US Machine repository:

```text
<US Machine repo>/
  package.json
  boot-setup-bundle/
    apply.sh
    sync-from-repo.sh
    scripts/
      plymouth/
      kiosk/
        chromium-policies/
        chromium-kiosk-hardening.sh
        install-chromium-policies.sh
        install-kiosk-wayland-session.sh
        labwc-kiosk/
```

---

## Apply on a machine

### From the repo root (recommended)

```bash
npm install --prefix backend
npm install --prefix frontend
bash boot-setup-bundle/apply.sh
sudo reboot
```

### Without `apply.sh`

```bash
sudo US_MACHINE_ROOT="/path/to/US Machine" bash boot-setup-bundle/scripts/plymouth/install-techmac-boot.sh
```

Use the real path to the checkout (the directory that contains `package.json`).

---

## What gets installed

| Component | Purpose |
|-----------|---------|
| **Plymouth `techmac`** | Boot / shutdown splash (Animation_Boot from Git) |
| **`us-machine-headless-web.service`** | Starts backend API + Vite preview on `:5173` before display |
| **`us-machine-plymouth-boot-wait.service`** | Keeps splash until HTTP is ready |
| **LightDM + labwc kiosk** | Minimal Wayland session (no LXDE desktop) |
| **Chromium kiosk** | Full-screen app via `frontend/scripts/launch-display-hdmi.sh` |
| **Chromium policies** | Disables “Save password?” and credential autofill |

### Chromium kiosk hardening (no password prompts)

Three layers (no `--enable-automation`, so no “controlled by automated test software” bar):

1. **Enterprise policy** → `/etc/chromium/policies/managed/99-usmachine-kiosk.json`
2. **Launch flags** → `PasswordManager` and related features disabled in `launch-display-hdmi.sh`
3. **Dedicated profile** → `~/.config/usmachine-chromium` with `password_manager_enabled: false`

Re-install policies only:

```bash
sudo bash boot-setup-bundle/scripts/kiosk/install-chromium-policies.sh
```

---

## Keeping the bundle in sync

After editing files under `scripts/plymouth/` or `scripts/kiosk/` in the repo:

```bash
bash boot-setup-bundle/sync-from-repo.sh
```

This copies shared assets into the bundle but **keeps** bundle-specific installers:

- `boot-setup-bundle/scripts/plymouth/install-techmac-boot.sh` (uses `US_MACHINE_ROOT`, bundle kiosk path)
- `boot-setup-bundle/scripts/kiosk/install-kiosk-wayland-session.sh` (uses `US_MACHINE_ROOT`)

Always copy new kiosk assets into both trees when adding files (e.g. `chromium-policies/`, `chromium-kiosk-hardening.sh`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| **Black screen** after boot | `launch-display-hdmi.sh` exited (bash error) | Check `/tmp/display-kiosk.log`; fix script, `sudo systemctl restart lightdm` |
| **“Save password?”** bar | Old Chromium profile or policy missing | Run `install-chromium-policies.sh`, reboot |
| **“Chrome is being controlled…”** bar | `--enable-automation` in launcher | Remove it; use policy + profile only (current tree) |
| **Plymouth never quits** | API or Vite not on `:5173` | `journalctl -u us-machine-headless-web.service -f` |

Logs:

- `/tmp/display-kiosk.log` — labwc autostart / launcher
- `/tmp/display-chromium.log` — Chromium stderr
- `/tmp/maindata-api.log` — backend API

---

## Restore LXDE desktop

See the footer of `install-kiosk-wayland-session.sh` after install, or:

```bash
sudo sed -i 's/^user-session=.*/user-session=LXDE-pi-labwc/' /etc/lightdm/lightdm.conf
sudo sed -i 's/^autologin-session=.*/autologin-session=LXDE-pi-labwc/' /etc/lightdm/lightdm.conf
sudo sed -i 's|^session-wrapper=.*|#session-wrapper=lightdm-session|' /etc/lightdm/lightdm.conf
sudo cp -a /etc/xdg/labwc/autostart.bak.usmachine /etc/xdg/labwc/autostart
sudo systemctl restart lightdm
```
