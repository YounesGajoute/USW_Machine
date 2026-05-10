# Backend — Settings API (SQLite)

Express.js REST API that manages system settings, users, product references, and proxies Vision Pi requests.

## Structure

```
backend/
  index.mjs                  # Express app — all API routes
  package.json
  .env.example               # Environment variable reference
  lib/
    db.mjs                   # SQLite (better-sqlite3) — schema, migrations, seeding
    referenceSerialBridge.mjs # USB serial fan-out to welding + shrink machines
    crypto.mjs               # PBKDF2-SHA-256 password hashing
    defaultUsers.mjs         # Reads config/default-users.json for seed accounts
    legacyRoleNames.mjs      # Role string normalisation / legacy migration
    roleTabAccessDefaults.mjs# Default tab-access matrix per role
  config/
    default-users.json       # Built-in seed user accounts (usernames, passwords, roles)
  data/
    maindata.db              # SQLite database (created at runtime)
  scripts/
    launch-display-hdmi.sh   # Start API + static server + Chromium kiosk
    install-service.sh       # Install systemd user service
    display-chromium.service # systemd unit template
  vision_master_client.py    # CLI tool to drive the Vision Pi over REST + Socket.IO
```

## Quick Start

```bash
# Install dependencies (once)
npm install --prefix backend

# Start the API server (port 3333 by default)
npm start --prefix backend

# Or from inside the backend folder
cd backend && npm start
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

| Variable            | Default                        | Description                              |
|---------------------|--------------------------------|------------------------------------------|
| `PORT`              | `3333`                         | API listen port                          |
| `SESSION_SECRET`    | `app-dev-change-me-in-production` | Express session signing secret        |
| `MAIN_DATA_DB_PATH` | `data/maindata.db`             | Override SQLite file path                |
| `VISION_URL`        | `http://192.168.10.2:5000`     | Vision Pi base URL                       |
| `VISION_REMOTE_KEY` | _(empty)_                      | Forwarded as `X-Vision-Remote-Key`       |
| `REFERENCE_SERIAL_WELD_PATH` | _(empty)_           | e.g. `/dev/ttyUSB0` — welding machine (FT232) |
| `REFERENCE_SERIAL_SHRINK_PATH` | _(empty)_         | e.g. `/dev/ttyUSB1` — shrink machine (FT232) |
| `REFERENCE_SERIAL_BAUD` | `9600`                    | Default baud when per-port vars unset      |
| `REFERENCE_SERIAL_LINE_ENDING` | `CRLF`            | Default line ending when per-port unset    |
| `REFERENCE_SERIAL_WELD_BAUD` | _(inherits)_        | Optional override for weld port only       |
| `REFERENCE_SERIAL_SHRINK_BAUD` | _(inherits)_      | Optional override for shrink port only     |
| `REFERENCE_SERIAL_WELD_LINE_ENDING` | _(inherits)_ | Optional override for weld port only       |
| `REFERENCE_SERIAL_SHRINK_LINE_ENDING` | _(inherits)_ | Optional override for shrink port only   |

**Device paths** (`REFERENCE_SERIAL_WELD_PATH`, `REFERENCE_SERIAL_SHRINK_PATH`) are **only** read from this environment / `.env` file, not from the SQLite settings UI. Per-machine serial port options (`baudRate`, `bufferSize`, `dataBits`, `flowControl`, `parity`, `stopBits`, `lineEnding`) are configured in **Settings → Hardware → Serial communication** and stored under `reference_serial.weld` / `reference_serial.shrink` in `system_settings`. Other env vars in the table above are optional fallbacks when a value is not stored in the DB.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Login |
| GET | `/api/auth/me` | session | Current user |
| POST | `/api/auth/logout` | session | Logout |
| POST | `/api/auth/change-password` | session | Change own password |
| GET | `/api/settings/system` | optional | System settings |
| PUT | `/api/settings/system` | admin | Update system settings |
| GET | `/api/settings/role-tab-access` | optional | Tab access matrix |
| PUT | `/api/settings/role-tab-access` | admin | Update tab access |
| GET | `/api/users` | admin | List users |
| POST | `/api/users` | admin | Create user |
| PATCH | `/api/users/:id` | admin | Update user |
| DELETE | `/api/users/:id` | admin | Delete user |
| GET | `/api/vision/ping` | — | Ping Vision Pi |
| POST | `/api/vision/info` | session | Vision Pi info |
| GET | `/api/vision/programs` | optional | List Vision programs |
| POST | `/api/vision/programs` | optional | Create Vision program |
| DELETE | `/api/vision/programs/:id` | optional | Delete Vision program |
| GET | `/api/references` | optional | List product references |
| POST | `/api/references` | optional | Create reference |
| PATCH | `/api/references/:id` | optional | Update reference |
| DELETE | `/api/references/:id` | optional | Delete reference |
| POST | `/api/references/broadcast` | optional | Body `{ code }` — validate against DB, send name to welding + shrink serial ports |
| GET | `/api/health` | — | Health check |

## Vision Master Client (Python CLI)

```bash
# Install dependencies
pip install requests "python-socketio[client]"

# Usage
python backend/vision_master_client.py --help
python backend/vision_master_client.py info
python backend/vision_master_client.py programs
python backend/vision_master_client.py run-once 2
python backend/vision_master_client.py socket 2
```
