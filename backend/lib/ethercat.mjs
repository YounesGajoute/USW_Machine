/**
 * EtherCAT Manager for US Machine backend
 *
 * Spawns ethercat_bridge.py as a child process and communicates via
 * JSON over stdin/stdout. Exposes an async API for the Express routes.
 *
 * Architecture:
 *   Express API  ──JSON/HTTP──►  frontend
 *       │
 *   EtherCATManager (this file)
 *       │  stdin/stdout JSON
 *   ethercat_bridge.py  ──pysoem──►  XHS_ECT_MD1616_V2.0
 */

import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  realpathSync,
  writeFileSync,
} from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
/** Last successfully opened EtherCAT NIC — survives eth1→enx* renames across boots. */
const PERSISTED_IFACE_PATH = join(__dirname, '../data/.ethercat-interface');

// ── Load config ───────────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = join(__dirname, '../config/ethercat.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`EtherCAT config not found: ${configPath}`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  const base = raw.ethercat;
  const envIface = (process.env.ETHERCAT_INTERFACE || '').trim();
  if (envIface) {
    return { ...base, interface: envIface };
  }
  return base;
}

/** Same defaults as setup/main/hardware/EtherCATManager.ts (Air Leakage / legacy app). */
const IFACE_MAX_RETRIES = 5;
const IFACE_RETRY_MS = 3000;
const IFACE_STABILIZE_MS = 2000;
/** Cold-boot: USB RTL8152 appears ~2s after power-on; poll before first initialize throws. */
const IFACE_ENUM_WAIT_MS = Number(process.env.ETHERCAT_IFACE_ENUM_WAIT_MS || 10000);
const IFACE_ENUM_POLL_MS = Number(process.env.ETHERCAT_IFACE_ENUM_POLL_MS || 250);
const DEFAULT_INIT_TIMEOUT_MS = Number(process.env.ETHERCAT_INIT_TIMEOUT_MS || 30000);
const DEFAULT_HEALTH_INTERVAL_MS = Number(process.env.ETHERCAT_HEALTH_INTERVAL_MS || 10000);

function listSysNetInterfaces() {
  const netDir = '/sys/class/net';
  try {
    if (!existsSync(netDir)) return [];
    return readdirSync(netDir).filter((name) => {
      try {
        return statSync(join(netDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readSysTrimmed(path) {
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return '';
  }
}

/** Kernel driver bound to a NIC (e.g. 'r8152' for the Realtek RTL8152 USB EtherCAT adapter). */
function interfaceDriver(name) {
  try {
    return realpathSync(`/sys/class/net/${name}/device/driver`).split('/').pop() ?? '';
  } catch {
    return '';
  }
}

function interfaceHasCarrier(name) {
  return readSysTrimmed(`/sys/class/net/${name}/carrier`) === '1';
}

/** EtherCAT NICs run raw frames with no IP configured — an assigned IPv4 means it's a LAN port. */
function interfaceHasIPv4(name) {
  try {
    return execSync(`ip -o -4 addr show dev ${name}`, { encoding: 'utf-8', timeout: 3000 }).trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Onboard Pi LAN (Cadence macb / predictable `end0`) must never be used for EtherCAT.
 * At cold boot the USB RTL8152 briefly appears as `eth0` while macb still holds that
 * name — falling back to "any wired no-IP" previously picked macb and failed.
 */
function isOnboardLanInterface(name, driver = interfaceDriver(name)) {
  if (!name) return false;
  if (driver === 'macb') return true;
  if (name === 'end0' || name.startsWith('end')) return true;
  return false;
}

/**
 * Kernel assigns ethN to USB NICs before udev renames to enxMAC (~10–50ms window).
 * Auto-detect must not open that name — wait for the stable enx* rename.
 */
function isTransientKernelUsbName(name) {
  return typeof name === 'string' && /^eth\d+$/.test(name);
}

/** True when this NIC is the Realtek USB EtherCAT adapter (or a stable enx* name for it). */
function isEtherCATCapableInterface(name) {
  if (!name || !existsSync(`/sys/class/net/${name}`)) return false;
  if (isOnboardLanInterface(name)) return false;
  const driver = interfaceDriver(name);
  if (driver === 'r8152') return true;
  // Predictable USB names stay enx* after udev rename even if driver symlink is briefly gone.
  if (name.startsWith('enx') && !interfaceHasIPv4(name)) return true;
  return false;
}

/** Auto-detect / cold-boot pick: stable enx* only (never transient ethN during udev rename). */
function isStableEtherCATAutoName(name) {
  return (
    typeof name === 'string' &&
    name.startsWith('enx') &&
    isEtherCATCapableInterface(name)
  );
}

function loadPersistedEtherCATInterface() {
  try {
    const name = readFileSync(PERSISTED_IFACE_PATH, 'utf8').trim();
    return name || null;
  } catch {
    return null;
  }
}

function persistEtherCATInterface(name) {
  if (!name || !isEtherCATCapableInterface(name)) return;
  try {
    mkdirSync(dirname(PERSISTED_IFACE_PATH), { recursive: true });
    writeFileSync(PERSISTED_IFACE_PATH, `${name}\n`, { encoding: 'utf8', mode: 0o644 });
  } catch (err) {
    console.warn(
      `[EtherCAT] Could not persist interface '${name}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Find the EtherCAT NIC when the configured name (e.g. eth1) is absent — Raspberry Pi OS
 * uses predictable names (enxAABBCCDDEEFF) for the USB adapter instead of eth1.
 *
 * Only stable enx* (r8152) is eligible for auto-detect. Never macb/`end*`, and never
 * transient kernel ethN during the udev rename window.
 */
function autoDetectEtherCATInterface() {
  const isExcluded = (n) =>
    n === 'lo' ||
    n.startsWith('wlan') ||
    n.startsWith('tailscale') ||
    n.startsWith('docker') ||
    n.startsWith('veth') ||
    n.startsWith('br-') ||
    isOnboardLanInterface(n) ||
    isTransientKernelUsbName(n);

  const candidates = listSysNetInterfaces()
    .filter((n) => !isExcluded(n))
    .map((name) => ({
      name,
      driver: interfaceDriver(name),
      carrier: interfaceHasCarrier(name),
      hasIp: interfaceHasIPv4(name),
    }))
    .filter((c) => isStableEtherCATAutoName(c.name));

  return (
    candidates.find((c) => c.driver === 'r8152' && c.carrier && !c.hasIp) ||
    candidates.find((c) => c.driver === 'r8152' && !c.hasIp) ||
    candidates.find((c) => c.carrier && !c.hasIp) ||
    candidates.find((c) => !c.hasIp) ||
    null
  )?.name ?? null;
}

/**
 * Sync pick — no logging. Prefer: capable configured/env → persisted → stable enx* auto-detect.
 * Never returns onboard LAN or transient ethN from auto-detect.
 */
function pickEtherCATInterface(requested) {
  const req = typeof requested === 'string' ? requested.trim() : '';
  if (req && isEtherCATCapableInterface(req)) {
    // Explicit env/config may use ethN on atypical setups; never allow onboard.
    if (!isOnboardLanInterface(req)) return req;
  }

  const persisted = loadPersistedEtherCATInterface();
  if (persisted && isEtherCATCapableInterface(persisted) && !isOnboardLanInterface(persisted)) {
    return persisted;
  }

  return autoDetectEtherCATInterface();
}

/**
 * Resolve the interface pysoem should open (single attempt, with operator logs).
 * Prefer: capable configured/env name → persisted successful NIC → enx* auto-detect.
 * Never return onboard LAN. Returns null if USB adapter is not in sysfs yet.
 */
function resolveEtherCATInterface(requested) {
  const req = typeof requested === 'string' ? requested.trim() : '';
  if (req && existsSync(`/sys/class/net/${req}`) && !isEtherCATCapableInterface(req)) {
    console.warn(
      `[EtherCAT] Ignoring unsuitable interface '${req}' ` +
        `(driver ${interfaceDriver(req) || 'unknown'}) — not the USB EtherCAT adapter.`,
    );
  }

  const picked = pickEtherCATInterface(requested);
  if (!picked) return null;

  const persisted = loadPersistedEtherCATInterface();
  if (req && picked !== req && persisted && picked === persisted) {
    console.warn(
      `[EtherCAT] Configured interface '${req}' not usable — using persisted EtherCAT NIC '${picked}' ` +
        `(driver ${interfaceDriver(picked) || 'unknown'}, carrier ${interfaceHasCarrier(picked) ? 'up' : 'down'}).`,
    );
  } else if (req && picked !== req && picked !== persisted) {
    console.warn(
      `[EtherCAT] Configured interface '${req || '(none)'}' not found — auto-detected EtherCAT NIC '${picked}' ` +
        `(driver ${interfaceDriver(picked) || 'unknown'}, carrier ${interfaceHasCarrier(picked) ? 'up' : 'down'}, no IP).`,
    );
  } else if (!req && picked !== persisted) {
    console.warn(
      `[EtherCAT] Auto-detected EtherCAT NIC '${picked}' ` +
        `(driver ${interfaceDriver(picked) || 'unknown'}, carrier ${interfaceHasCarrier(picked) ? 'up' : 'down'}, no IP).`,
    );
  }
  return picked;
}

/**
 * Poll until a capable EtherCAT NIC appears (USB enum + udev enx* rename), then return it.
 * Avoids a false "boot connect failed" + health reconnect for the normal cold-boot race.
 */
async function waitForEtherCATInterface(requested) {
  const immediate = pickEtherCATInterface(requested);
  if (immediate) {
    // Still emit resolve logs for operator clarity when not waiting.
    return resolveEtherCATInterface(requested) ?? immediate;
  }

  const waitMs = Number.isFinite(IFACE_ENUM_WAIT_MS) && IFACE_ENUM_WAIT_MS > 0 ? IFACE_ENUM_WAIT_MS : 10000;
  const pollMs = Number.isFinite(IFACE_ENUM_POLL_MS) && IFACE_ENUM_POLL_MS > 0 ? IFACE_ENUM_POLL_MS : 250;
  const deadline = Date.now() + waitMs;
  console.log(
    `[EtherCAT] Waiting up to ${waitMs}ms for USB EtherCAT adapter (r8152 / enx*)…` +
      (requested ? ` (configured '${requested}')` : ''),
  );

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const picked = pickEtherCATInterface(requested);
    if (picked) {
      console.log(
        `[EtherCAT] USB EtherCAT NIC ready: '${picked}' ` +
          `(driver ${interfaceDriver(picked) || 'unknown'}, carrier ${interfaceHasCarrier(picked) ? 'up' : 'down'})`,
      );
      return picked;
    }
  }

  console.warn(
    `[EtherCAT] USB EtherCAT adapter (r8152 / enx*) not ready after ${waitMs}ms` +
      (requested ? ` (configured '${requested}' unavailable)` : '') +
      ' — health reconnect will retry.',
  );
  return null;
}

/** @internal test helpers */
export const __ethercatIfaceTest = {
  isOnboardLanInterface,
  isEtherCATCapableInterface,
  isTransientKernelUsbName,
  isStableEtherCATAutoName,
  autoDetectEtherCATInterface,
  pickEtherCATInterface,
  resolveEtherCATInterface,
  waitForEtherCATInterface,
  persistEtherCATInterface,
  loadPersistedEtherCATInterface,
  PERSISTED_IFACE_PATH,
  IFACE_ENUM_WAIT_MS,
  IFACE_ENUM_POLL_MS,
};

function resolveInterfaceUpHelper() {
  const paths = [
    join(PROJECT_ROOT, 'scripts', 'ethercat_interface_up.sh'),
    join(PROJECT_ROOT, 'dist', 'scripts', 'ethercat_interface_up.sh'),
  ];
  return paths.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

function interfaceHasPromisc(name) {
  try {
    return execSync(`ip link show ${name}`, { encoding: 'utf-8', timeout: 3000 }).includes('PROMISC');
  } catch {
    return false;
  }
}

/** EtherCAT raw frames are incompatible with PROMISC — reference base always disables it. */
function disablePromiscMode(iface) {
  const helper = resolveInterfaceUpHelper();
  try {
    if (helper) {
      execSync(`bash "${helper}" ${iface} promisc_off`, { timeout: 15000, stdio: 'pipe' });
    } else {
      execSync(`sudo -E ip link set ${iface} promisc off`, { timeout: 5000, stdio: 'pipe' });
    }
    return true;
  } catch (e) {
    console.warn(
      `[EtherCAT] Could not disable PROMISC on ${iface}: ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }
}

/**
 * Keep NetworkManager off the EtherCAT NIC. NM DHCP/PROMISC flaps kill SOEM mid-cycle.
 * Script: scripts/network/us-machine-ethercat-unmanaged.sh
 */
function ensureEthercatNicUnmanaged(iface) {
  const script = join(PROJECT_ROOT, 'scripts', 'network', 'us-machine-ethercat-unmanaged.sh');
  if (!existsSync(script)) {
    console.warn(`[EtherCAT] unmanaged helper missing: ${script}`);
    return { ok: false, reason: 'script_missing' };
  }
  try {
    const out = execSync(`sudo -n bash "${script}" "${iface}" 2>&1`, {
      timeout: 20000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    for (const line of String(out).split('\n').filter(Boolean)) {
      console.log(`[EtherCAT] ${line}`);
    }
    return { ok: true, output: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stdout = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout || '') : '';
    console.warn(`[EtherCAT] Could not unmanage ${iface} via NM: ${msg}`);
    if (stdout) console.warn(stdout.trim());
    // Best-effort fallback without persistent conf
    try {
      execSync(`sudo -n nmcli device set ${iface} managed no`, { timeout: 5000, stdio: 'pipe' });
      execSync(`sudo -n ip link set ${iface} promisc off`, { timeout: 5000, stdio: 'pipe' });
      return { ok: true, fallback: true };
    } catch {
      return { ok: false, reason: msg };
    }
  }
}

function nmManagedState(iface) {
  try {
    const v = execSync(`nmcli -g GENERAL.NM-MANAGED device show ${iface}`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return v || 'unknown';
  } catch {
    return 'unknown';
  }
}

// #region agent log
function debugEthercatLog(hypothesisId, location, message, data) {
  const payload = {
    sessionId: '855101',
    runId: process.env.DEBUG_RUN_ID || 'ethercat-guard',
    hypothesisId,
    location,
    message,
    data: data || {},
    timestamp: Date.now(),
  };
  try {
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '855101' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch { /* ignore */ }
  try {
    appendFileSync(join(PROJECT_ROOT, '.cursor', 'debug-855101.log'), `${JSON.stringify(payload)}\n`);
  } catch { /* ignore */ }
}
// #endregion

/**
 * Wait for NIC, bring it up, disable PROMISC — matches legacy Electron EtherCATManager.initialize()
 * (scripts/ethercat_interface_up.sh + ip link checks). Reduces failures when eth* is down at boot.
 */
async function prepareEtherCATNetworkInterface(iface) {
  if (process.env.ETHERCAT_SKIP_INTERFACE_PREP === '1') {
    console.log('[EtherCAT] Skipping interface prep (ETHERCAT_SKIP_INTERFACE_PREP=1)');
    return;
  }

  const helper = resolveInterfaceUpHelper();

  const ifacePath = `/sys/class/net/${iface}`;
  let seen = false;
  for (let attempt = 1; attempt <= IFACE_MAX_RETRIES; attempt++) {
    if (existsSync(ifacePath)) {
      seen = true;
      break;
    }
    console.log(`[EtherCAT] Interface ${iface} not found yet (${attempt}/${IFACE_MAX_RETRIES})…`);
    if (attempt < IFACE_MAX_RETRIES) await sleep(IFACE_RETRY_MS);
  }
  if (!seen) {
    const avail = listSysNetInterfaces();
    const hint = avail.length ? ` Available: ${avail.join(', ')}` : '';
    throw new Error(`EtherCAT interface '${iface}' does not exist after ${IFACE_MAX_RETRIES} attempts.${hint}`);
  }

  // NetworkManager must not own this NIC (DHCP/PROMISC flaps break SOEM).
  const unmanage = ensureEthercatNicUnmanaged(iface);
  // #region agent log
  debugEthercatLog('B', 'ethercat.mjs:prepare', 'ensure unmanaged', {
    iface,
    ok: unmanage.ok,
    managed: nmManagedState(iface),
    promisc: interfaceHasPromisc(iface),
  });
  // #endregion
  if (!unmanage.ok) {
    console.warn(
      `[EtherCAT] WARNING: ${iface} may still be NM-managed — I/O (PNOZ/DO) can drop mid-cycle`,
    );
  }

  let interfaceUp = false;
  let attemptedBringUp = false;

  for (let attempt = 1; attempt <= IFACE_MAX_RETRIES; attempt++) {
    try {
      const status = execSync(`ip link show ${iface}`, { encoding: 'utf-8', timeout: 3000 });
      if (status.includes('state UP')) {
        interfaceUp = true;
        if (status.includes('PROMISC')) {
          console.log(`[EtherCAT] ${iface} has PROMISC — disabling for EtherCAT`);
          await disablePromiscMode(iface);
          await sleep(1000);
        }
        break;
      }

      if (!attemptedBringUp && (attempt === 1 || attempt === IFACE_MAX_RETRIES)) {
        attemptedBringUp = true;
        console.log(`[EtherCAT] ${iface} not UP — running interface bring-up (legacy setup pattern)…`);
        try {
          if (helper) {
            execSync(`bash "${helper}" ${iface} promisc_off 2>&1`, {
              timeout: 15000,
              encoding: 'utf-8',
              stdio: 'pipe',
            });
          } else {
            try {
              execSync(`sudo -E ip link set ${iface} promisc off`, { timeout: 5000, stdio: 'pipe' });
            } catch { /* ignore */ }
            execSync(`sudo -E ip link set ${iface} up`, { timeout: 10000, stdio: 'pipe' });
          }
          await sleep(5000);
        } catch (e) {
          console.warn(
            `[EtherCAT] Bring-up attempt failed (passwordless sudo may be required): ${e instanceof Error ? e.message : String(e)}`
          );
        }
        for (let v = 0; v < 5; v++) {
          try {
            const verify = execSync(`ip link show ${iface}`, { encoding: 'utf-8', timeout: 3000 });
            if (verify.includes('state UP')) {
              interfaceUp = true;
              console.log(`[EtherCAT] ${iface} is UP after bring-up`);
              break;
            }
          } catch { /* retry */ }
          if (v < 4) await sleep(2000);
        }
        if (interfaceUp) break;
      }

      if (!interfaceUp && attempt < IFACE_MAX_RETRIES) {
        console.log(`[EtherCAT] Waiting for ${iface} to come UP (${attempt}/${IFACE_MAX_RETRIES})…`);
        await sleep(IFACE_RETRY_MS);
      }
    } catch (e) {
      if (attempt === IFACE_MAX_RETRIES) {
        console.warn(`[EtherCAT] Could not read ${iface} with ip: ${e instanceof Error ? e.message : String(e)}`);
      } else {
        await sleep(IFACE_RETRY_MS);
      }
    }
  }

  if (!interfaceUp) {
    try {
      const final = execSync(`ip link show ${iface}`, { encoding: 'utf-8', timeout: 3000 });
      if (final.includes('state UP')) interfaceUp = true;
    } catch { /* ignore */ }
  }

  if (!interfaceUp) {
    const avail = listSysNetInterfaces();
    const hint = avail.length ? ` Available interfaces: ${avail.join(', ')}` : '';
    throw new Error(
      `EtherCAT interface '${iface}' is not UP after ${IFACE_MAX_RETRIES} attempts. ` +
        `Configure the link or run: sudo bash scripts/ethercat_interface_up.sh ${iface} promisc_off${hint ? `. ${hint}` : ''}`
    );
  }

  // Reference base: PROMISC must stay off for pysoem — NetworkManager may re-enable it.
  if (interfaceHasPromisc(iface)) {
    console.log(`[EtherCAT] ${iface} still has PROMISC before bridge start — disabling`);
    await disablePromiscMode(iface);
    await sleep(500);
  }

  console.log(`[EtherCAT] Waiting ${IFACE_STABILIZE_MS / 1000}s for ${iface} to stabilize before pysoem…`);
  await sleep(IFACE_STABILIZE_MS);
}

/** site-packages for venv (same discovery as setup/main/hardware/EtherCATManager.ts). */
function getVenvSitePackagesPath() {
  const venvLib = join(PROJECT_ROOT, 'venv_ethercat', 'lib');
  try {
    if (!existsSync(venvLib)) return null;
    const dir = readdirSync(venvLib).find((d) => d.startsWith('python'));
    if (!dir) return null;
    const sp = join(venvLib, dir, 'site-packages');
    return existsSync(sp) ? sp : null;
  } catch {
    return null;
  }
}

/**
 * How to spawn pysoem — same priority as setup/main/hardware/EtherCATManager.ts:
 * 1) ethercat_bridge_sudo.sh (sudo -E venv python) if sudo allowed
 * 2) ethercat_python_wrapper.sh (cap-preserving exec)
 * 3) run_ethercat_python.sh or direct venv python + PYTHONPATH
 */
function resolveBridgeSpawn(bridgeScript, iface, deviceName, resolvedXml) {
  const sudoPaths = [
    join(PROJECT_ROOT, 'dist', 'scripts', 'ethercat_bridge_sudo.sh'),
    join(PROJECT_ROOT, 'scripts', 'ethercat_bridge_sudo.sh'),
  ];
  const capPaths = [
    join(PROJECT_ROOT, 'dist', 'scripts', 'ethercat_python_wrapper.sh'),
    join(PROJECT_ROOT, 'scripts', 'ethercat_python_wrapper.sh'),
  ];
  const sudoWrapper = sudoPaths.find((p) => existsSync(p) && statSync(p).isFile());
  const capWrapper = capPaths.find((p) => existsSync(p) && statSync(p).isFile());

  const hasNoNewPrivileges = process.env.SYSTEMD_NO_NEW_PRIVILEGES === '1';
  const canUseSudo = Boolean(sudoWrapper) && !hasNoNewPrivileges;
  /** Same as legacy: prefer sudo wrapper when available (passwordless sudo). */
  const preferSudo = canUseSudo;

  const venvPython = join(PROJECT_ROOT, 'venv_ethercat', 'bin', 'python3');
  const venvExists = existsSync(venvPython);

  let cmd;
  /** @type {string[]} */
  let args;
  let env = { ...process.env, PYTHONUNBUFFERED: '1' };

  if (preferSudo) {
    cmd = '/bin/bash';
    args = [sudoWrapper, iface, deviceName, resolvedXml];
    console.log('[EtherCAT] Bridge spawn: sudo wrapper (recommended, same as legacy Electron app)');
    console.log(`[EtherCAT]   → ${sudoWrapper}`);
  } else if (capWrapper) {
    cmd = capWrapper;
    args = [bridgeScript, iface, deviceName, resolvedXml];
    console.log('[EtherCAT] Bridge spawn: capability wrapper (same as legacy Electron fallback)');
    console.log(`[EtherCAT]   → ${capWrapper}`);
  } else if (venvExists) {
    const launcher = join(PROJECT_ROOT, 'scripts', 'run_ethercat_python.sh');
    if (existsSync(launcher)) {
      cmd = '/bin/bash';
      args = [launcher, bridgeScript, iface, deviceName, resolvedXml];
      console.log('[EtherCAT] Bridge spawn: run_ethercat_python.sh (capped interpreter + venv packages)');
    } else {
      const sp = getVenvSitePackagesPath();
      if (sp) {
        env.PYTHONPATH = env.PYTHONPATH ? `${sp}:${env.PYTHONPATH}` : sp;
      }
      try {
        cmd = realpathSync(venvPython);
      } catch {
        cmd = venvPython;
      }
      args = [bridgeScript, iface, deviceName, resolvedXml];
      console.warn(
        '[EtherCAT] Bridge spawn: direct venv Python — if permissions fail, install wrappers or run setup_ethercat_permissions.sh'
      );
    }
  } else if (canUseSudo && sudoWrapper) {
    cmd = '/bin/bash';
    args = [sudoWrapper, iface, deviceName, resolvedXml];
    console.warn('[EtherCAT] Bridge spawn: sudo wrapper (no venv)');
  } else {
    throw new Error(
      `EtherCAT venv not found at ${venvPython}. Run: bash scripts/setup_ethercat_venv.sh` +
        (hasNoNewPrivileges
          ? '\n(systemd NoNewPrivileges=yes: use capabilities — sudo bash scripts/setup_ethercat_permissions.sh)'
          : '\nOr ensure scripts/ethercat_bridge_sudo.sh exists and passwordless sudo is configured.')
    );
  }

  return { cmd, args, env };
}

// ── EtherCATManager ───────────────────────────────────────────────────────────

export class EtherCATManager extends EventEmitter {
  #pythonProcess = null;
  #isInitialized = false;
  #shuttingDown = false;
  #pendingCommands = new Map();   // id → { resolve, reject, timeout }
  #commandIdCounter = 0;
  #readBuffer = '';
  #healthTimer = null;
  #config;
  #resolvedInterface = null;
  #lastHealthOkAt = null;
  #lastHealthAdvisory = null;

  // Default timeout for bridge commands (ms)
  #defaultTimeout = 8000;
  static #BRIDGE_EXIT_MS = 8000;
  static #BRIDGE_SIGTERM_MS = 3000;

  constructor(config) {
    super();
    this.#config = config ?? loadConfig();
  }

  get isInitialized() { return this.#isInitialized; }

  // ── Spawn bridge ────────────────────────────────────────────────────────────

  async initialize() {
    if (this.#isInitialized) return;

    const { interface: cfgIface, xmlPath, device } = this.#config;
    const deviceName = device?.name ?? 'XHS_ECT_MD1616_V2.0';

    const iface = await waitForEtherCATInterface(cfgIface);
    this.#resolvedInterface = iface;
    if (!iface) {
      throw new Error(
        'EtherCAT USB NIC (r8152 / enx*) not ready yet — wait for adapter enumeration and retry',
      );
    }

    await prepareEtherCATNetworkInterface(iface);

    // Resolve bridge script (reference base also checks dist/scripts)
    const bridgePaths = [
      join(PROJECT_ROOT, 'scripts', 'ethercat_bridge.py'),
      join(PROJECT_ROOT, 'dist', 'scripts', 'ethercat_bridge.py'),
    ];
    const bridgeScript = bridgePaths.find(p => existsSync(p));
    if (!bridgeScript) {
      throw new Error(`ethercat_bridge.py not found. Searched:\n  ${bridgePaths.join('\n  ')}`);
    }

    // Resolve XML path (may be relative to project root)
    const resolvedXml = existsSync(xmlPath)
      ? xmlPath
      : join(PROJECT_ROOT, xmlPath);

    const { cmd, args, env } = resolveBridgeSpawn(bridgeScript, iface, deviceName, resolvedXml);

    const spawnOpts = {
      cwd: PROJECT_ROOT,
      env,
    };

    console.log(`[EtherCAT] Starting bridge: ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log(`[EtherCAT] Interface: ${iface}, Device: ${deviceName}, XML: ${resolvedXml}`);

    this.#pythonProcess = spawn(cmd, args, spawnOpts);

    this.#pythonProcess.stdout.on('data', (chunk) => this.#onData(chunk));
    this.#pythonProcess.stderr.on('data', (chunk) => {
      process.stderr.write(`[EtherCAT bridge] ${chunk}`);
    });
    this.#pythonProcess.on('exit', (code) => {
      console.warn(`[EtherCAT] Bridge process exited with code ${code}`);
      this.#isInitialized = false;
      this.#rejectAllPending(new Error(`Bridge process exited (code ${code})`));
      this.emit('disconnected', code);
    });
    this.#pythonProcess.on('error', (err) => {
      console.error(`[EtherCAT] Bridge spawn error: ${err.message}`);
      this.emit('error', err);
    });

    // Init may wait up to 20 OP retries (reference bridge) plus PDO mapping.
    try {
      const result = await this.#sendCommand('init', {}, DEFAULT_INIT_TIMEOUT_MS);
      if (result.status !== 'ok') {
        throw new Error(`EtherCAT init failed: ${result.error ?? JSON.stringify(result)}`);
      }

      this.#isInitialized = true;
      persistEtherCATInterface(iface);
      console.log(`[EtherCAT] Initialized — ${result.slave_count} slave(s) found`);
      this.emit('connected', result);

      this.#startHealthCheck();
    } catch (err) {
      await this.cleanup();
      throw err;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async setOutput(pin, value) {
    this.#assertInitialized();
    return this.#sendCommand('set_output', { pin, value: value ? 1 : 0 });
  }

  /**
   * Set multiple digital outputs in one PDO cycle (same wire exchange).
   * Prefer this for paired valves (e.g. both clamps) so they change together.
   *
   * @param {Array<{ pin: number, value: boolean|number }>} outputs
   */
  async setOutputs(outputs) {
    this.#assertInitialized();
    if (!Array.isArray(outputs) || outputs.length === 0) {
      throw new Error('setOutputs requires a non-empty array of { pin, value }');
    }
    return this.#sendCommand('set_outputs', {
      outputs: outputs.map(({ pin, value }) => ({
        pin,
        value: value ? 1 : 0,
      })),
    });
  }

  async getInput(pin) {
    this.#assertInitialized();
    return this.#sendCommand('get_input', { pin });
  }

  async getAllInputs() {
    this.#assertInitialized();
    return this.#sendCommand('get_all_inputs', {});
  }

  async getAllOutputs() {
    this.#assertInitialized();
    return this.#sendCommand('get_all_outputs', {});
  }

  async ping() {
    if (!this.#pythonProcess) return { status: 'error', error: 'Not started' };
    return this.#sendCommand('ping', {});
  }

  async enableButtonMonitor(startPin, stopPin) {
    this.#assertInitialized();
    return this.#sendCommand('enable_button_monitor', { start_pin: startPin, stop_pin: stopPin });
  }

  async cleanup() {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    this.#isInitialized = false;
    this.#stopHealthCheck();

    const proc = this.#pythonProcess;
    this.#pythonProcess = null;
    this.#rejectAllPending(new Error('EtherCAT shutting down'));

    if (!proc) {
      this.#shuttingDown = false;
      return;
    }

    console.log('[EtherCAT] Closing bridge (slave INIT, outputs safe)…');

    try {
      if (proc.stdin?.writable) {
        await this.#sendCommandToProcess(proc, 'cleanup', {}, 5000);
      }
    } catch (_) {
      /* bridge may already be exiting */
    }

    try {
      proc.stdin?.end();
    } catch (_) {
      /* ignore */
    }

    await this.#waitForProcessExit(proc, EtherCATManager.#BRIDGE_EXIT_MS);

    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch (_) {
        /* ignore */
      }
      await this.#waitForProcessExit(proc, EtherCATManager.#BRIDGE_SIGTERM_MS);
    }

    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch (_) {
        /* ignore */
      }
    }

    console.log('[EtherCAT] Bridge closed');
    this.#shuttingDown = false;
  }

  getStatus() {
    return {
      initialized: this.#isInitialized,
      bridgeRunning: this.#pythonProcess !== null && !this.#pythonProcess.killed,
      pendingCommands: this.#pendingCommands.size,
      lastHealthOkAt: this.#lastHealthOkAt,
      lastHealthAdvisory: this.#lastHealthAdvisory,
      healthCheckIntervalMs: DEFAULT_HEALTH_INTERVAL_MS,
      config: {
        interface: this.#resolvedInterface ?? this.#config.interface,
        configuredInterface: this.#config.interface,
        persistedInterface: loadPersistedEtherCATInterface(),
        device: this.#config.device?.name,
      },
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #assertInitialized() {
    if (!this.#isInitialized) throw new Error('EtherCAT not initialized');
  }

  #sendCommand(command, params = {}, timeout = this.#defaultTimeout) {
    const proc = this.#pythonProcess;
    if (!proc) {
      return Promise.reject(new Error('Bridge process not running'));
    }
    return this.#sendCommandToProcess(proc, command, params, timeout);
  }

  #sendCommandToProcess(proc, command, params = {}, timeout = this.#defaultTimeout) {
    return new Promise((resolve, reject) => {
      if (this.#shuttingDown && command !== 'cleanup') {
        return reject(new Error('EtherCAT is shutting down'));
      }

      const id = ++this.#commandIdCounter;
      const timer = setTimeout(() => {
        this.#pendingCommands.delete(id);
        reject(new Error(`EtherCAT command '${command}' timed out after ${timeout}ms`));
      }, timeout);

      this.#pendingCommands.set(id, { command, resolve, reject, timeout: timer });

      const msg = JSON.stringify({ id, command, params }) + '\n';
      try {
        proc.stdin.write(msg);
      } catch (e) {
        clearTimeout(timer);
        this.#pendingCommands.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  #waitForProcessExit(proc, timeoutMs) {
    if (proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #onData(chunk) {
    this.#readBuffer += chunk.toString();
    const lines = this.#readBuffer.split('\n');
    this.#readBuffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);

        // Unsolicited event (e.g. button_press)
        if (msg.event) {
          this.emit(msg.event, msg.data);
          continue;
        }

        // Response to a pending command
        const pending = this.#pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.#pendingCommands.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch (e) {
        console.warn(`[EtherCAT] Could not parse bridge output: ${trimmed}`);
      }
    }
  }

  #rejectAllPending(error) {
    for (const [id, pending] of this.#pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pendingCommands.clear();
  }

  #startHealthCheck() {
    let lastAdvisoryLogAt = 0;
    this.#healthTimer = setInterval(async () => {
      try {
        const result = await this.ping();
        if (result.status === 'ok') {
          this.#lastHealthOkAt = Date.now();
          if (result.warning) {
            this.#lastHealthAdvisory = result.warning;
            const now = Date.now();
            // Reference bridge: WKC mismatch is advisory — slave may still be AL=OP and I/O usable.
            if (now - lastAdvisoryLogAt > 60_000) {
              lastAdvisoryLogAt = now;
              console.warn(`[EtherCAT] Health advisory: ${result.warning}`);
            }
          } else {
            this.#lastHealthAdvisory = null;
          }
          this.emit('health_ok', result);
          return;
        }
        console.warn(`[EtherCAT] Health check failed: ${result.error}`);
        this.emit('health_warning', result);
      } catch (e) {
        console.warn(`[EtherCAT] Health check error: ${e.message}`);
        this.emit('health_warning', { status: 'error', error: e.message });
      }
    }, DEFAULT_HEALTH_INTERVAL_MS);
    this.#healthTimer.unref();
  }

  #stopHealthCheck() {
    if (this.#healthTimer) {
      clearInterval(this.#healthTimer);
      this.#healthTimer = null;
    }
  }
}

// ── Pin map constants (XHS_ECT_MD1616 — 16 DO + 16 DI hardware, 0-based) ────────
//
// DO0–DO5: pneumatic valves (sinking to GND).
// DO6 ESTOP_CH2: NC E-Stop relay on PNOZ X2.8P Safety Channel 2 (S21-S22) —
//   ON = emergency state, OFF = E-Stop released.
// DO9 PNOZ_RESET: resets the PNOZ X2.8P.
// DO7 TOWER_RED, DO10 TOWER_GREEN, DO11 TOWER_YELLOW: indicator tower lights.
// DO12 BUZZER: indicator tower buzzer.
// DO13 BTN_INIT_LED, DO14 BTN_START_LED: LEDs in the panel Init/Start buttons
//   (software-driven by the panel-mode resolver; 1 = on).
// DO8 LIGHTING: machine work light (1 = on, 0 = off).
// DO15 ARM_EVO500: ARM momentary pulse in pick&place (STCS-evo500 only).
// DI0 INIT_BUTTON, DI1 START_BUTTON. DI3 PNOZ_FEEDBACK: verifies K1/K2 state.
// DI5 DOOR_RIGHT_2, DI6 DOOR_RIGHT_1: right doors wired into PNOZ Safety Channel 1
//   (hardware-enforced, in series with the E-Stop); software reads for status only.
// DI7 DOOR_BACK: back door, software-enforced via DO6 (Channel 2), model-gated.
//   1 = door open.
// DI8 AIR_PRESSURE: air pressure regulator input — 1 = pressure present/OK, 0 = low/absent.
// DI9 CLAMP_LEFT_TRIGGER, DI10 CLAMP_RIGHT_TRIGGER: clamp closed confirmation
//   (1 = triggered/closed). Used by CLAMP_TRIGGER_MODE=off|di10|di9|both (legacy di11→di9).
// DI15 ESTOP_BUTTON: emergency button input — 1 = released/OK, 0 = pressed.
//   Both DI8 and DI15 must read OK (plus the model's doors closed) before Setup may
//   leave POWER_OFF for INIT. DI2, DI4, DI11–DI14 are spare/unassigned.
export const DO = Object.freeze({
  CLAMP_RIGHT:  0,   // 1 = close, 0 = open
  CLAMP_LEFT:   1,   // 1 = close, 0 = open
  LEVER_UP:     2,   // 1 = up, 0 = down
  PP_CLAMP:     3,   // 1 = close, 0 = open
  PULLER:       4,   // 1 = enabled, 0 = disabled
  MAIN_AIR:     5,   // 1 = on, 0 = off
  ESTOP_CH2:    6,   // PNOZ X2.8P Safety Channel 2 (S21-S22). Default: 1 = emergency, 0 = released (CH2 active). Invert with ESTOP_CH2_RELEASE_HIGH=1.
  DO_6:         6,   // alias of ESTOP_CH2
  TOWER_RED:    7,   // Indicator tower — red light (1 = on)
  DO_7:         7,   // alias of TOWER_RED
  DO_8:         8,
  LIGHTING:     8,   // DO8 machine work lighting (1 = on, 0 = off), alias of DO_8
  PNOZ_RESET:   9,   // Reset of the PNOZ X2.8P safety relay (rising-edge pulse)
  DO_9:         9,   // alias of PNOZ_RESET
  TOWER_GREEN:  10,  // Indicator tower — green light (1 = on)
  DO_10:        10,  // alias of TOWER_GREEN
  TOWER_YELLOW: 11,  // Indicator tower — yellow light (1 = on)
  DO_11:        11,  // alias of TOWER_YELLOW
  BUZZER:       12,  // Indicator tower — buzzer (1 = on)
  DO_12:        12,  // alias of BUZZER
  BTN_INIT_LED:  13, // Panel Initialization button LED (1 = on)
  DO_13:        13,  // alias of BTN_INIT_LED
  BTN_START_LED: 14, // Panel Start button LED (1 = on)
  DO_14:        14,  // alias of BTN_START_LED
  DO_15:        15,
  ARM_EVO500:   15,  // DO15 ARM (momentary pulse in pick&place, STCS-evo500 only), alias of DO_15
});

export const DI = Object.freeze({
  INIT_BUTTON:   0,  // Panel Initialization button (24V → DI0)
  START_BUTTON:  1,  // Panel Start button (24V → DI1) — production sequence
  PNOZ_FEEDBACK: 3,  // PNOZ X2.8P feedback loop — K1/K2 state: 1 = release (armed), 0 = emergency
  DOOR_RIGHT_2:  5,  // Right-side door, second port — 1 = open (PNOZ Channel 1, hardware)
  DOOR_RIGHT_1:  6,  // Right-side door, first port — 1 = open (PNOZ Channel 1, hardware)
  DOOR_BACK:     7,  // Backside door — 1 = open (software-enforced via DO6, Channel 2)
  AIR_PRESSURE:  8,  // Air pressure regulator input — 1 = pressure present/OK, 0 = low/absent
  CLAMP_LEFT_TRIGGER:  9,  // Left clamp closed confirmation — 1 = triggered/closed
  CLAMP_RIGHT_TRIGGER: 10, // Right clamp closed confirmation — 1 = triggered/closed
  ESTOP_BUTTON:  15, // Emergency button input — 1 = released/OK, 0 = pressed
});

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;

export function getEtherCATManager() {
  if (!_instance) {
    _instance = new EtherCATManager();
  }
  return _instance;
}
