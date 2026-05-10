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
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

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

/**
 * Wait for NIC, bring it up, disable PROMISC — matches legacy Electron EtherCATManager.initialize()
 * (scripts/ethercat_interface_up.sh + ip link checks). Reduces failures when eth* is down at boot.
 */
async function prepareEtherCATNetworkInterface(iface) {
  if (process.env.ETHERCAT_SKIP_INTERFACE_PREP === '1') {
    console.log('[EtherCAT] Skipping interface prep (ETHERCAT_SKIP_INTERFACE_PREP=1)');
    return;
  }

  const helper = join(PROJECT_ROOT, 'scripts', 'ethercat_interface_up.sh');
  const hasHelper = existsSync(helper);

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

  let interfaceUp = false;
  let attemptedBringUp = false;

  for (let attempt = 1; attempt <= IFACE_MAX_RETRIES; attempt++) {
    try {
      const status = execSync(`ip link show ${iface}`, { encoding: 'utf-8', timeout: 3000 });
      if (status.includes('state UP')) {
        interfaceUp = true;
        if (status.includes('PROMISC')) {
          console.log(`[EtherCAT] ${iface} has PROMISC — disabling for EtherCAT`);
          try {
            if (hasHelper) {
              execSync(`bash "${helper}" ${iface} promisc_off`, { timeout: 15000, stdio: 'pipe' });
            } else {
              execSync(`sudo -E ip link set ${iface} promisc off`, { timeout: 5000, stdio: 'pipe' });
            }
            await sleep(1000);
          } catch (e) {
            console.warn(`[EtherCAT] Could not disable PROMISC: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        break;
      }

      if (!attemptedBringUp && (attempt === 1 || attempt === IFACE_MAX_RETRIES)) {
        attemptedBringUp = true;
        console.log(`[EtherCAT] ${iface} not UP — running interface bring-up (legacy setup pattern)…`);
        try {
          if (hasHelper) {
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
  #pendingCommands = new Map();   // id → { resolve, reject, timeout }
  #commandIdCounter = 0;
  #readBuffer = '';
  #healthTimer = null;
  #config;

  // Default timeout for bridge commands (ms)
  #defaultTimeout = 8000;

  constructor(config) {
    super();
    this.#config = config ?? loadConfig();
  }

  get isInitialized() { return this.#isInitialized; }

  // ── Spawn bridge ────────────────────────────────────────────────────────────

  async initialize() {
    if (this.#isInitialized) return;

    const { interface: iface, xmlPath, device } = this.#config;
    const deviceName = device?.name ?? 'XHS_ECT_MD1616_V2.0';

    await prepareEtherCATNetworkInterface(iface);

    // Resolve bridge script
    const bridgePaths = [
      join(PROJECT_ROOT, 'scripts', 'ethercat_bridge.py'),
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

    // Send init command
    const result = await this.#sendCommand('init', {}, 15000);
    if (result.status !== 'ok') {
      throw new Error(`EtherCAT init failed: ${result.error ?? JSON.stringify(result)}`);
    }

    this.#isInitialized = true;
    console.log(`[EtherCAT] Initialized — ${result.slave_count} slave(s) found`);
    this.emit('connected', result);

    this.#startHealthCheck();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async setOutput(pin, value) {
    this.#assertInitialized();
    return this.#sendCommand('set_output', { pin, value: value ? 1 : 0 });
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
    this.#stopHealthCheck();
    if (this.#pythonProcess) {
      try {
        await this.#sendCommand('cleanup', {}, 5000);
      } catch (_) { /* ignore */ }
      this.#pythonProcess.kill();
      this.#pythonProcess = null;
    }
    this.#isInitialized = false;
  }

  getStatus() {
    return {
      initialized: this.#isInitialized,
      bridgeRunning: this.#pythonProcess !== null && !this.#pythonProcess.killed,
      pendingCommands: this.#pendingCommands.size,
      config: {
        interface: this.#config.interface,
        device: this.#config.device?.name,
      },
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #assertInitialized() {
    if (!this.#isInitialized) throw new Error('EtherCAT not initialized');
  }

  #sendCommand(command, params = {}, timeout = this.#defaultTimeout) {
    return new Promise((resolve, reject) => {
      if (!this.#pythonProcess) {
        return reject(new Error('Bridge process not running'));
      }

      const id = ++this.#commandIdCounter;
      const timer = setTimeout(() => {
        this.#pendingCommands.delete(id);
        reject(new Error(`EtherCAT command '${command}' timed out after ${timeout}ms`));
      }, timeout);

      this.#pendingCommands.set(id, { command, resolve, reject, timeout: timer });

      const msg = JSON.stringify({ id, command, params }) + '\n';
      this.#pythonProcess.stdin.write(msg);
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
    this.#healthTimer = setInterval(async () => {
      try {
        const result = await this.ping();
        if (result.status !== 'ok') {
          console.warn(`[EtherCAT] Health check failed: ${result.error}`);
          this.emit('health_warning', result);
        }
      } catch (e) {
        console.warn(`[EtherCAT] Health check error: ${e.message}`);
      }
    }, 10000); // every 10 seconds
    this.#healthTimer.unref();
  }

  #stopHealthCheck() {
    if (this.#healthTimer) {
      clearInterval(this.#healthTimer);
      this.#healthTimer = null;
    }
  }
}

// ── Pin map constants (matches backend/config/ethercat.config.json) ───────────
//
// Digital Outputs (DO) — matches backend/config/ethercat.config.json
// Command logic (except ARM_LED): 0 = Open / Down, 1 = Close / Up
export const DO = Object.freeze({
  ARM_LED:            0,   // 1 = on, 0 = off
  GRIPPER_1:          1,
  GRIPPER_2:          2,
  LIFTER:             3,   // 0 = down, 1 = up
  GRIPPER_LIFTER_1:   4,
  GRIPPER_LIFTER_2:   5,
  TENSION_CYL_1:      6,
  TENSION_CYL_2:      7,
});

// Digital Inputs (DI)
export const DI = Object.freeze({
  PP_L_PICK_FB:         0,   // Pick & Place Left  — pick position sensor
  PP_L_PLACE_FB:        1,   // Pick & Place Left  — place position sensor
  PP_R_PICK_FB:         2,   // Pick & Place Right — pick position sensor
  PP_R_PLACE_FB:        3,   // Pick & Place Right — place position sensor
  LIFT_GRIP_A_OPEN_FB:  4,   // Lifter — Gripper A open confirmed
  LIFT_GRIP_A_CLOSE_FB: 5,   // Lifter — Gripper A closed confirmed
  LIFT_GRIP_B_OPEN_FB:  6,   // Lifter — Gripper B open confirmed
  LIFT_GRIP_B_CLOSE_FB: 7,   // Lifter — Gripper B closed confirmed
  LIFT_CYL_UP_FB:       8,   // Lifter — cylinder UP confirmed
  LIFT_CYL_DN_FB:       9,   // Lifter — cylinder DOWN confirmed
});

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;

export function getEtherCATManager() {
  if (!_instance) {
    _instance = new EtherCATManager();
  }
  return _instance;
}
