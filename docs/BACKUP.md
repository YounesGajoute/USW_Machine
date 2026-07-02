# US Machine — Backup & Restore Guide

Full backup and restore procedures for the **US Machine** project on the Raspberry Pi kiosk host.

| Item | Path |
|------|------|
| **Project root** | `/home/bot/US Machine` |
| **Backup storage** | `/home/bot/backups/` |
| **This document** | `/home/bot/US Machine/docs/BACKUP.md` |

---

## 1. What a full backup includes

A full backup is a **gzip tarball** of the entire project directory. Nothing is excluded at archive time.

| Category | Contents |
|----------|----------|
| Application | `frontend/`, `backend/`, `scripts/`, `boot-setup-bundle/` |
| Arduino firmware | `arduino/` (including `actule_Sketch/`, `Backup_Sketch/`, `pick_place_controller/`, etc.) |
| Pick & place (new stack) | `New_version_pick&place/` |
| EtherCAT / Python | `venv_ethercat/`, `check_ethercat.sh`, hardware docs |
| Git history | `.git/` |
| Dependencies | `node_modules/` under frontend and backend |
| Local config | `backend/.env`, `frontend/.env` (if present on disk) |
| Databases | SQLite files under `backend/data/` and `frontend/server/data/` |
| Documentation & assets | PDFs, images, `HARDWARE_ARCHITECTURE.md`, `docs/`, etc. |

**Not included:** files outside `/home/bot/US Machine` (system config, `/etc/usmachine/`, kiosk systemd units, etc.).

---

## 2. Current backups

| Version / name | Archive | Created | Size | Git commit |
|----------------|---------|---------|------|------------|
| **v1.0.0.1** (latest) | `US_Machine_v1.0.0.1.tar.gz` | 2026-06-23 | ~92 MB (~305 MB uncompressed) | `e7ab019` |
| Initial snapshot | `US-Machine_2026-05-15_082808.tar.gz` | 2026-05-15 | ~75 MB (~279 MB uncompressed) | `7a37aa4` |

All archives live in `/home/bot/backups/`. Each has a companion `.sha256` checksum file.

**Latest SHA-256 (`US_Machine_v1.0.0.1.tar.gz`):**

```
bdac0c68a15337464504b8709093815ca0a956d54114950bb5484afcd4461237
```

---

## 3. Create a new full backup

### 3.1 Version-named backup (recommended for releases)

Use a version string such as `US_Machine_v1.0.0.2`:

```bash
mkdir -p /home/bot/backups

VERSION="US_Machine_v1.0.0.2"
ARCHIVE="/home/bot/backups/${VERSION}.tar.gz"

tar -czf "$ARCHIVE" -C /home/bot "US Machine"
sha256sum "$ARCHIVE" | tee "${ARCHIVE}.sha256"
ls -lh "$ARCHIVE" "${ARCHIVE}.sha256"
```

Record the git commit at backup time:

```bash
cd "/home/bot/US Machine"
git log -1 --format='%h %s'
```

### 3.2 Timestamp-named backup (ad-hoc / daily)

```bash
mkdir -p /home/bot/backups

STAMP=$(date +%Y-%m-%d_%H%M%S)
ARCHIVE="/home/bot/backups/US-Machine_${STAMP}.tar.gz"

tar -czf "$ARCHIVE" -C /home/bot "US Machine"
sha256sum "$ARCHIVE" | tee "${ARCHIVE}.sha256"
ls -lh "$ARCHIVE"
```

### 3.3 One-liner (version variable)

```bash
VERSION="US_Machine_v1.0.0.2" && mkdir -p /home/bot/backups && tar -czf "/home/bot/backups/${VERSION}.tar.gz" -C /home/bot "US Machine" && sha256sum "/home/bot/backups/${VERSION}.tar.gz" | tee "/home/bot/backups/${VERSION}.tar.gz.sha256"
```

### 3.4 Before you backup

Optional but recommended:

```bash
# Confirm project is in a good state
cd "/home/bot/US Machine"
git status

# Check free disk space (need ~2× project size for tarball + headroom)
du -sh "/home/bot/US Machine"
df -h /home/bot/backups
```

---

## 4. Verify a backup

### 4.1 Checksum verification

```bash
cd /home/bot/backups
sha256sum -c US_Machine_v1.0.0.1.tar.gz.sha256
```

Expected output: `US_Machine_v1.0.0.1.tar.gz: OK`

Verify any archive by replacing the filename:

```bash
sha256sum -c /home/bot/backups/US-Machine_2026-05-15_082808.tar.gz.sha256
```

### 4.2 Manual checksum compare

```bash
sha256sum /home/bot/backups/US_Machine_v1.0.0.1.tar.gz
```

Compare the output to the value stored in the `.sha256` file.

### 4.3 List archive contents (without extracting)

```bash
tar -tzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz | head -50
```

Count entries:

```bash
tar -tzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz | wc -l
```

Check a specific path (e.g. active Arduino sketches):

```bash
tar -tzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz | grep actule_Sketch
```

### 4.4 Test extract to a temp folder (dry run)

```bash
mkdir -p /tmp/us-machine-restore-test
tar -xzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz -C /tmp/us-machine-restore-test
ls -la "/tmp/us-machine-restore-test/US Machine"
rm -rf /tmp/us-machine-restore-test
```

---

## 5. Restore from backup

**Always verify the checksum before restoring.**

### 5.1 Restore to the original location

```bash
# Optional: keep the current project as a safety copy
mv "/home/bot/US Machine" "/home/bot/US Machine.old.$(date +%Y%m%d)"

# Extract (creates /home/bot/US Machine/)
cd /home/bot
tar -xzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz
```

### 5.2 Restore to a different path

```bash
mkdir -p /path/to/restore
tar -xzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz -C /path/to/restore
# Result: /path/to/restore/US Machine/
```

### 5.3 Restore a single file or folder from the archive

```bash
# Example: restore only the active centring sketch
tar -xzf /home/bot/backups/US_Machine_v1.0.0.1.tar.gz \
  -C /tmp \
  "US Machine/arduino/actule_Sketch/centring_controller/centring_controller.ino"
```

---

## 6. After restore — post-restore checklist

Run these steps after a full restore:

```bash
# 1. Verify checksum was OK (see section 4)

# 2. Rebuild frontend if dist/ is missing or outdated
cd "/home/bot/US Machine/frontend"
npm install
npm run build

# 3. Confirm backend dependencies
cd "/home/bot/US Machine/backend"
npm install

# 4. Check environment files (ports, serial devices, IPs)
cat "/home/bot/US Machine/backend/.env"
cat "/home/bot/US Machine/frontend/.env"

# 5. Restart services
cd "/home/bot/US Machine"
./start.sh
```

Adjust paths, ports, and device names in `.env` if restoring onto different hardware.

---

## 7. Copy backup off this device

### 7.1 Copy to USB drive

```bash
# List mounts to find USB path
lsblk
ls /media/

cp /home/bot/backups/US_Machine_v1.0.0.1.tar.gz /media/usb/
cp /home/bot/backups/US_Machine_v1.0.0.1.tar.gz.sha256 /media/usb/
```

Copy all backups:

```bash
cp /home/bot/backups/*.tar.gz* /media/usb/
```

### 7.2 Copy to another host (scp)

```bash
scp /home/bot/backups/US_Machine_v1.0.0.1.tar.gz \
    /home/bot/backups/US_Machine_v1.0.0.1.tar.gz.sha256 \
    user@other-host:/backups/us-machine/
```

### 7.3 Copy from another host (restore side)

```bash
scp user@pi-host:/home/bot/backups/US_Machine_v1.0.0.1.tar.gz* /home/bot/backups/
cd /home/bot/backups
sha256sum -c US_Machine_v1.0.0.1.tar.gz.sha256
```

---

## 8. List and manage backups

```bash
# List all backups with sizes
ls -lh /home/bot/backups/*.tar.gz

# Show checksum files
ls -lh /home/bot/backups/*.sha256

# Total space used by backups
du -sh /home/bot/backups/
```

Remove an old backup (only when you no longer need it):

```bash
rm /home/bot/backups/US-Machine_2026-05-15_082808.tar.gz
rm /home/bot/backups/US-Machine_2026-05-15_082808.tar.gz.sha256
```

---

## 9. Arduino firmware-only backup (optional)

For quick firmware snapshots without a full project archive, copy the active sketch folders:

```bash
STAMP=$(date +%Y-%m-%d_%H%M%S)
DEST="/home/bot/backups/arduino_${STAMP}"
mkdir -p "$DEST"

cp -a "/home/bot/US Machine/arduino/actule_Sketch" "$DEST/"
cp -a "/home/bot/US Machine/arduino/pick_place_controller" "$DEST/" 2>/dev/null || true

ls -la "$DEST"
```

Or tarball only the Arduino tree:

```bash
STAMP=$(date +%Y-%m-%d_%H%M%S)
tar -czf "/home/bot/backups/arduino_${STAMP}.tar.gz" \
  -C "/home/bot/US Machine" arduino/
sha256sum "/home/bot/backups/arduino_${STAMP}.tar.gz" | tee "/home/bot/backups/arduino_${STAMP}.tar.gz.sha256"
```

---

## 10. Version naming convention

| Pattern | Example | Use case |
|---------|---------|----------|
| `US_Machine_vX.Y.Z.W` | `US_Machine_v1.0.0.1` | Release / milestone backups |
| `US-Machine_YYYY-MM-DD_HHMMSS` | `US-Machine_2026-06-23_012108` | Ad-hoc or scheduled snapshots |
| `arduino_YYYY-MM-DD_HHMMSS` | `arduino_2026-06-23_012108` | Firmware-only backups |

When creating a versioned backup, update the **Current backups** table at the top of this document (or note the version in your change log).

---

## 11. Quick reference

| Task | Command |
|------|---------|
| Create versioned backup | `tar -czf /home/bot/backups/US_Machine_vX.Y.Z.W.tar.gz -C /home/bot "US Machine"` |
| Generate checksum | `sha256sum ARCHIVE.tar.gz \| tee ARCHIVE.tar.gz.sha256` |
| Verify checksum | `sha256sum -c ARCHIVE.tar.gz.sha256` |
| Restore full project | `tar -xzf ARCHIVE.tar.gz -C /home/bot` |
| List archive | `tar -tzf ARCHIVE.tar.gz \| less` |

---

*US Machine kiosk / leak-test interface — Raspberry Pi host.*
