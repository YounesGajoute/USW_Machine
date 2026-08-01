#!/usr/bin/env python3
"""Production-area start soak — N HMI-equivalent production cycles with recovery.

Simulates the operator path on a real machine (no .env skip-flag changes):

  Setup → IDLE/RUN (reference loaded) → Start → PRECHECK → CYCLE_START
       → COMPLETE → RESET → IDLE → RUN

On production FAIL / ERROR / timeout / hang / start reject:
  stop-production (always, best effort) → POST /api/machine/setup → wait ready → continue.

On SAFETY_LOCKOUT or POWER_OFF: abort the whole campaign immediately.
On HTTP 401/403 (login required): abort immediately (exit 2).
On N consecutive failed recoveries: abort (exit 1).

Preconditions (operator):
  - Backend listening (default http://127.0.0.1:3333)
  - EtherCAT connected
  - Product reference loaded on HMI
  - Doors closed, E-stop released, air OK
  - Clamps/cable ready per CLAMP_TRIGGER_MODE
  - Guest login-required off, or a session that allows machine ops

Usage:
  python3 scripts/production_start_soak.py [N] [CYCLE_TIMEOUT_S] [--base-url URL]
  python3 scripts/production_start_soak.py 100 240 --hang-fail-s 90 --max-consecutive-fails 3

Defaults: N=100, CYCLE_TIMEOUT_S=240, base=http://127.0.0.1:3333

Exit codes:
  0 — all cycles PASS
  1 — finished with fails, or aborted after consecutive recovery failures
  2 — preflight / setup / auth abort (cannot operate)
  3 — SAFETY_LOCKOUT / POWER_OFF abort
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = "http://127.0.0.1:3333"
SETTLE_GAP_S = 0.6
POLL_S = 0.12
PHASE_HANG_S_DEFAULT = 90.0
READY_TIMEOUT_S = 90.0
SETUP_HTTP_TIMEOUT_S = 180.0
RECOVERY_READY_TIMEOUT_S = 180.0
MAX_CONSECUTIVE_FAILS_DEFAULT = 3
HARD_ABORT_LIFECYCLES = frozenset({"SAFETY_LOCKOUT", "POWER_OFF"})

CORE_PHASES = [
    "close_clamps",
    "lever_up",
    "pp_clamp_close",
    "open_clamps",
    "lever_down",
]


class AuthDeniedError(RuntimeError):
    """Machine ops rejected with HTTP 401/403 (login required)."""

    def __init__(self, http_code: int, message: str) -> None:
        self.http_code = http_code
        super().__init__(message)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Run N production start cycles with per-cycle logs and Setup-on-fail recovery.",
    )
    p.add_argument(
        "n_cycles",
        nargs="?",
        type=int,
        default=100,
        help="Number of start cycles (default: 100)",
    )
    p.add_argument(
        "cycle_timeout_s",
        nargs="?",
        type=float,
        default=240.0,
        help="Per-cycle monitor timeout seconds (default: 240)",
    )
    p.add_argument(
        "--base-url",
        default=DEFAULT_BASE,
        help=f"Backend base URL (default: {DEFAULT_BASE})",
    )
    p.add_argument(
        "--hang-fail-s",
        type=float,
        default=PHASE_HANG_S_DEFAULT,
        help=(
            "Fail the cycle if the same production phase stays active longer than this "
            f"(default: {PHASE_HANG_S_DEFAULT}). Set 0 to only log hangs."
        ),
    )
    p.add_argument(
        "--max-consecutive-fails",
        type=int,
        default=MAX_CONSECUTIVE_FAILS_DEFAULT,
        help=(
            "Abort campaign after this many consecutive failed cycles whose recovery "
            f"did not restore canStartProduction (default: {MAX_CONSECUTIVE_FAILS_DEFAULT}). "
            "Set 0 to disable."
        ),
    )
    return p.parse_args(argv)


class SoakSession:
    def __init__(
        self,
        base_url: str,
        n_cycles: int,
        cycle_timeout_s: float,
        hang_fail_s: float,
        max_consecutive_fails: int,
    ) -> None:
        self.base = base_url.rstrip("/")
        self.n_cycles = n_cycles
        self.cycle_timeout_s = cycle_timeout_s
        self.hang_fail_s = hang_fail_s
        self.max_consecutive_fails = max_consecutive_fails
        self.run_id = f"soak-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        self.run_dir = REPO_ROOT / "tmp" / "production-soak" / self.run_id
        self.cycles_dir = self.run_dir / "cycles"
        self.session_log_path = self.run_dir / "session.log"
        self.report_path = self.run_dir / "report.json"
        self.cycles_dir.mkdir(parents=True, exist_ok=True)
        self.session_log_path.write_text("", encoding="utf-8")

    def tlog(self, msg: str) -> None:
        line = f"[{now_iso()}] {msg}"
        print(line, flush=True)
        with self.session_log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def api(self, method: str, path: str, body: Any = None, timeout: float = 30.0):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode())
            except Exception:
                payload = {"error": str(e)}
            if e.code in (401, 403):
                msg = (
                    (payload.get("error") or payload.get("message") or str(e))
                    if isinstance(payload, dict)
                    else str(e)
                )
                raise AuthDeniedError(e.code, f"HTTP {e.code}: {msg}") from e
            return e.code, payload
        except Exception as e:
            return 0, {"error": str(e)}

    def get_status(self) -> dict:
        code, body = self.api("GET", "/api/machine/init-status", timeout=8)
        if code != 200:
            raise RuntimeError(f"init-status {code}: {body}")
        return body

    def write_cycle(self, cycle_n: int, record: dict) -> Path:
        path = self.cycles_dir / f"cycle_{cycle_n:03d}.json"
        path.write_text(json.dumps(record, indent=2, default=str), encoding="utf-8")
        return path

    def write_report(self, report: dict) -> None:
        self.report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")


def conn_map(s: dict) -> dict:
    c = s.get("connectivity") or {}
    return {k: (v or {}).get("reachable") for k, v in c.items()}


def snapshot_gates(s: dict) -> dict:
    return {
        "lifecycle": s.get("lifecycleState"),
        "canStart": s.get("canStartProduction"),
        "block": s.get("productionBlockReason"),
        "initialized": s.get("initialized"),
        "machineInitialized": s.get("machineInitialized"),
        "referenceId": s.get("referenceId"),
        "referenceLoaded": s.get("referenceLoaded"),
        "running": s.get("productionRunning"),
        "active": s.get("isProductionActive"),
        "pnoz": s.get("pnozConfirmed"),
        "air": s.get("airPressureOk"),
        "estop": s.get("emergencyOk"),
        "doorsClosed": not s.get("anyDoorOpen") if s.get("anyDoorOpen") is not None else None,
        "safety": s.get("isSafetyLockout"),
        "isError": s.get("isError"),
        "lastError": s.get("lastError"),
        "conn": conn_map(s),
    }


def is_hard_abort(s: dict) -> bool:
    life = s.get("lifecycleState")
    return life in HARD_ABORT_LIFECYCLES or bool(s.get("isSafetyLockout"))


def is_ready(s: dict) -> bool:
    return bool(
        s.get("canStartProduction")
        and not s.get("productionRunning")
        and not s.get("isProductionActive")
        and s.get("lifecycleState") in ("RUN", "IDLE")
        and not s.get("isSafetyLockout")
        and not s.get("isError")
    )


def job_ids_match(tracked: str | None, candidate: str | None) -> bool:
    """True when candidate belongs to the tracked job (prefix-safe)."""
    if not tracked or not candidate:
        return False
    return tracked == candidate or tracked.startswith(candidate) or candidate.startswith(tracked)


def apply_job_outcome(record: dict, last: dict, tracked_job_id: str | None) -> bool:
    """
    Apply lastJob to record only when it matches this cycle's job.
    Returns True if outcome was applied.
    """
    last_id = last.get("jobId")
    if tracked_job_id and not job_ids_match(tracked_job_id, last_id):
        return False
    if not tracked_job_id and not last_id:
        return False
    record["jobId"] = last_id or tracked_job_id
    record["status"] = last.get("status")
    record["result"] = last.get("cycleResult")
    record["error"] = last.get("error") or record.get("error")
    record["ok"] = last.get("status") == "completed" and last.get("cycleResult") == "PASS"
    return True


def wait_ready(session: SoakSession, timeout_s: float) -> dict:
    t0 = time.time()
    last: dict = {}
    while time.time() - t0 < timeout_s:
        s = session.get_status()
        last = s
        if is_hard_abort(s):
            return s
        if is_ready(s):
            return s
        if s.get("lifecycleState") == "ERROR":
            return s
        time.sleep(0.25)
    return last


def stop_production(session: SoakSession) -> dict:
    code, body = session.api("POST", "/api/machine/stop-production", {}, timeout=30)
    return {"http": code, "body": body}


def run_setup(session: SoakSession) -> dict:
    """POST /api/machine/setup with HMI-equivalent requireButton=false."""
    code, body = session.api(
        "POST",
        "/api/machine/setup",
        {"requireButton": False},
        timeout=SETUP_HTTP_TIMEOUT_S,
    )
    return {"http": code, "ok": bool(body.get("ok")) if isinstance(body, dict) else False, "body": body}


def recover_to_ready(session: SoakSession) -> dict:
    """Always best-effort stop → setup → wait until canStartProduction."""
    recovery: dict[str, Any] = {
        "at": now_iso(),
        "stop": None,
        "setup": None,
        "ready": False,
        "final": None,
        "error": None,
    }
    try:
        session.tlog("RECOVERY stop-production (always before setup)")
        recovery["stop"] = stop_production(session)
        time.sleep(0.5)

        if is_hard_abort(session.get_status()):
            recovery["error"] = "hard abort before setup"
            recovery["final"] = snapshot_gates(session.get_status())
            return recovery

        session.tlog("RECOVERY setup (requireButton=false)")
        recovery["setup"] = run_setup(session)
        ready = wait_ready(session, RECOVERY_READY_TIMEOUT_S)
        recovery["final"] = snapshot_gates(ready)
        recovery["ready"] = is_ready(ready)
        if not recovery["ready"]:
            recovery["error"] = (
                ready.get("productionBlockReason")
                or ready.get("lastError")
                or ready.get("lifecycleState")
                or "not ready after setup"
            )
        return recovery
    except AuthDeniedError:
        raise
    except Exception as e:
        recovery["error"] = str(e)
        recovery["traceback"] = traceback.format_exc()
        try:
            recovery["final"] = snapshot_gates(session.get_status())
        except Exception:
            pass
        return recovery


def run_one_cycle(session: SoakSession, cycle_n: int) -> dict:
    record: dict[str, Any] = {
        "cycle": cycle_n,
        "startedAt": now_iso(),
        "ok": False,
        "result": None,
        "status": None,
        "jobId": None,
        "duration_s": None,
        "phases": [],
        "transitions": [],
        "startHttp": None,
        "error": None,
        "final": None,
        "connDrops": [],
        "hangEvents": [],
        "recovery": None,
        "hardAbort": False,
        "failReason": None,
    }

    ready = wait_ready(session, READY_TIMEOUT_S)
    if is_hard_abort(ready):
        record["error"] = f"hard abort before start: {ready.get('lifecycleState')}"
        record["hardAbort"] = True
        record["failReason"] = "safety"
        record["final"] = snapshot_gates(ready)
        return record

    if not is_ready(ready):
        record["error"] = (
            f"not ready: {ready.get('productionBlockReason') or ready.get('lifecycleState')}"
        )
        record["failReason"] = "not_ready"
        record["final"] = snapshot_gates(ready)
        return record

    start_holder: dict[str, Any] = {"done": False, "code": None, "body": None, "exc": None}

    def do_start() -> None:
        try:
            code, body = session.api(
                "POST",
                "/api/machine/start-production",
                {"requireButton": False},
                timeout=session.cycle_timeout_s + 30,
            )
            start_holder["code"] = code
            start_holder["body"] = body
        except AuthDeniedError:
            raise
        except Exception as e:
            start_holder["exc"] = str(e)
        finally:
            start_holder["done"] = True

    # Auth errors from the start thread must surface on the main thread.
    start_auth: list[AuthDeniedError] = []

    def do_start_safe() -> None:
        try:
            do_start()
        except AuthDeniedError as e:
            start_auth.append(e)
            start_holder["done"] = True
            start_holder["exc"] = str(e)

    th = threading.Thread(target=do_start_safe, daemon=True)
    th.start()

    t0 = time.time()
    prev_key = None
    saw_running = False
    tracked_job_id: str | None = None
    hang_phase = None
    hang_since = None
    last_conn = None

    session.tlog(f"CYCLE {cycle_n} start issued")

    while time.time() - t0 < session.cycle_timeout_s:
        if start_auth:
            raise start_auth[0]

        try:
            s = session.get_status()
        except AuthDeniedError:
            raise
        except Exception as e:
            record["transitions"].append({"t": round(time.time() - t0, 2), "pollError": str(e)})
            time.sleep(POLL_S)
            continue

        if is_hard_abort(s):
            record["hardAbort"] = True
            record["failReason"] = "safety"
            record["error"] = f"hard abort during cycle: {s.get('lifecycleState')}"
            record["final"] = snapshot_gates(s)
            last = s.get("lastJob") or {}
            apply_job_outcome(record, last, tracked_job_id)
            break

        phase = s.get("productionPhase")
        running = bool(s.get("productionRunning") or s.get("isProductionActive"))
        active_id = s.get("activeJobId")
        if running:
            saw_running = True
            if active_id and not tracked_job_id:
                tracked_job_id = str(active_id)
                record["jobId"] = tracked_job_id

        conn = conn_map(s)
        if last_conn is not None:
            drops = {k: conn.get(k) for k in conn if last_conn.get(k) and not conn.get(k)}
            if drops:
                drop_row = {"t": round(time.time() - t0, 2), "drops": drops, "phase": phase}
                record["connDrops"].append(drop_row)
                session.tlog(f"CYCLE {cycle_n} connectivity drop: {drops}")
        last_conn = conn

        # Hang detection: same phase too long while running → fail cycle
        if running and phase and session.hang_fail_s > 0:
            if phase != hang_phase:
                hang_phase = phase
                hang_since = time.time()
            elif hang_since and (time.time() - hang_since) > session.hang_fail_s:
                stuck_s = round(time.time() - hang_since, 1)
                hang_row = {"t": round(time.time() - t0, 2), "phase": phase, "stuck_s": stuck_s}
                record["hangEvents"].append(hang_row)
                record["failReason"] = "phase_hang"
                record["error"] = (
                    f"phase hang >{session.hang_fail_s}s: {phase} (stuck {stuck_s}s)"
                )
                session.tlog(f"CYCLE {cycle_n} FAIL phase hang: {phase} stuck={stuck_s}s")
                record["final"] = snapshot_gates(s)
                break

        key = (
            s.get("lifecycleState"),
            phase,
            running,
            (active_id or "")[:8],
            (s.get("lastJob") or {}).get("status"),
            (s.get("lastJob") or {}).get("cycleResult"),
            (s.get("lastJob") or {}).get("jobId"),
        )
        if key != prev_key:
            row = {
                "t": round(time.time() - t0, 2),
                "lifecycle": s.get("lifecycleState"),
                "code": s.get("lifecycleCode"),
                "phase": phase,
                "running": running,
                "job": (active_id or "")[:8],
                "lastStatus": (s.get("lastJob") or {}).get("status"),
                "lastResult": (s.get("lastJob") or {}).get("cycleResult"),
                "lastJobId": ((s.get("lastJob") or {}).get("jobId") or "")[:8],
                "canStart": s.get("canStartProduction"),
                "err": s.get("lastError"),
            }
            record["transitions"].append(row)
            if phase and phase not in record["phases"]:
                record["phases"].append(phase)
            prev_key = key

            if (
                saw_running
                and not running
                and s.get("lifecycleState") in ("RUN", "IDLE", "ERROR", "SAFETY_LOCKOUT", "COMPLETE")
            ):
                time.sleep(SETTLE_GAP_S)
                s2 = session.get_status()
                if not (s2.get("productionRunning") or s2.get("isProductionActive")):
                    last = s2.get("lastJob") or {}
                    applied = apply_job_outcome(record, last, tracked_job_id)
                    if not applied:
                        # Prefer HTTP body later; do not accept stale lastJob.
                        record["error"] = record.get("error") or (
                            f"settle without matching lastJob "
                            f"(tracked={tracked_job_id}, last={last.get('jobId')})"
                        )
                        record["failReason"] = record.get("failReason") or "job_mismatch"
                    else:
                        if not record.get("error"):
                            record["error"] = last.get("error") or s2.get("lastError")
                        if not record["ok"]:
                            record["failReason"] = record.get("failReason") or "cycle_fail"
                    record["final"] = snapshot_gates(s2)
                    if is_hard_abort(s2):
                        record["hardAbort"] = True
                        record["failReason"] = "safety"
                    break

        if start_holder["done"] and not saw_running:
            body = start_holder["body"] or {}
            if start_holder["code"] and start_holder["code"] >= 400:
                record["startHttp"] = {"code": start_holder["code"], "body": body}
                record["error"] = (
                    body.get("error") or start_holder.get("exc") or f"HTTP {start_holder['code']}"
                )
                record["failReason"] = "start_reject"
                break
            if start_holder["exc"]:
                record["error"] = start_holder["exc"]
                record["failReason"] = "start_error"
                break
            # HTTP returned ok without saw_running — use body job outcome if present
            if body.get("jobId") and not tracked_job_id:
                tracked_job_id = str(body.get("jobId"))
                record["jobId"] = tracked_job_id
            if body.get("cycleResult") is not None or body.get("ok") is not None:
                if body.get("jobId"):
                    record["jobId"] = body.get("jobId")
                record["result"] = body.get("cycleResult")
                record["status"] = body.get("status")
                record["ok"] = body.get("ok") is True and body.get("cycleResult") == "PASS"
                if not record["ok"]:
                    record["error"] = body.get("error") or record.get("error")
                    record["failReason"] = record.get("failReason") or "cycle_fail"
                break

        time.sleep(POLL_S)
    else:
        s = session.get_status()
        record["error"] = f"cycle timeout after {session.cycle_timeout_s}s (phase={s.get('productionPhase')})"
        record["failReason"] = "timeout"
        record["final"] = snapshot_gates(s)
        record["final"]["lastJob"] = s.get("lastJob")
        if is_hard_abort(s):
            record["hardAbort"] = True
            record["failReason"] = "safety"
        last = s.get("lastJob") or {}
        apply_job_outcome(record, last, tracked_job_id)

    th.join(timeout=5)
    if start_auth:
        raise start_auth[0]

    if start_holder["done"]:
        body = start_holder["body"] or {}
        record["startHttp"] = {
            "code": start_holder["code"],
            "ok": body.get("ok"),
            "jobId": body.get("jobId"),
            "error": body.get("error") or start_holder.get("exc"),
            "cycleResult": body.get("cycleResult"),
            "status": body.get("status"),
        }
        body_job = body.get("jobId")
        if body_job and not tracked_job_id:
            tracked_job_id = str(body_job)
            record["jobId"] = tracked_job_id

        # Prefer HTTP body only when it matches this cycle's job (or we never tracked one).
        if record["result"] is None and body.get("cycleResult") is not None:
            if not tracked_job_id or not body_job or job_ids_match(tracked_job_id, str(body_job)):
                record["result"] = body.get("cycleResult")
                record["status"] = body.get("status") or record["status"]
                record["ok"] = body.get("ok") is True and body.get("cycleResult") == "PASS"
                if body_job:
                    record["jobId"] = body_job
                if not record["ok"]:
                    record["failReason"] = record.get("failReason") or "cycle_fail"
                    if body.get("error"):
                        record["error"] = body.get("error")

        # Failure HTTP without cycleResult still carries the real fault (e.g. MOVEAMMT2 0xF3).
        # Prefer that over a stale job_mismatch when we already tracked this cycle's job.
        if (
            not record["ok"]
            and record.get("failReason") == "job_mismatch"
            and body.get("error")
            and (
                not body_job
                or not tracked_job_id
                or job_ids_match(tracked_job_id, str(body_job))
            )
        ):
            record["error"] = body.get("error")
            record["result"] = body.get("cycleResult") or "FAIL"
            record["status"] = body.get("status") or "failed"
            record["failReason"] = "cycle_fail"
            if body_job:
                record["jobId"] = body_job

        # If monitor said PASS but HTTP body for same job says otherwise, trust body.
        if (
            record["ok"]
            and body.get("cycleResult")
            and body_job
            and tracked_job_id
            and job_ids_match(tracked_job_id, str(body_job))
            and not (body.get("ok") is True and body.get("cycleResult") == "PASS")
        ):
            record["ok"] = False
            record["result"] = body.get("cycleResult")
            record["status"] = body.get("status") or record["status"]
            record["error"] = body.get("error") or record.get("error")
            record["failReason"] = "cycle_fail"

    # PASS with no observed phases is suspect (monitor miss) — still count as fail for soak honesty
    if record["ok"] and saw_running and not record["phases"]:
        record["ok"] = False
        record["failReason"] = "no_phases"
        record["error"] = "PASS claimed but no production phases observed"

    record["duration_s"] = round(time.time() - t0, 2)
    record["finishedAt"] = now_iso()
    record["trackedJobId"] = tracked_job_id
    if record["ok"]:
        record["missingCorePhases"] = [p for p in CORE_PHASES if p not in record["phases"]]
    elif not record.get("failReason"):
        record["failReason"] = "unknown"
    return record


def preflight_and_arm(session: SoakSession) -> tuple[bool, dict]:
    """Check gates; if not ready (and not hard abort), run Setup once."""
    try:
        s = session.get_status()
    except AuthDeniedError as e:
        return False, {"error": str(e), "authDenied": True}
    except Exception as e:
        return False, {"error": f"init-status failed: {e}"}

    gates = snapshot_gates(s)
    session.tlog(f"PREFLIGHT {json.dumps(gates)}")

    conn = gates.get("conn") or {}
    if conn.get("ethercat") is False:
        return False, {**gates, "error": "EtherCAT not reachable"}

    if not gates.get("referenceLoaded"):
        return False, {**gates, "error": "no reference loaded — load a product reference on the HMI first"}

    if is_hard_abort(s):
        return False, {
            **gates,
            "error": f"hard abort lifecycle={s.get('lifecycleState')} — clear E-stop/doors then re-run",
        }

    if is_ready(s):
        return True, gates

    session.tlog("PREFLIGHT not ready — running Setup")
    try:
        setup = run_setup(session)
    except AuthDeniedError as e:
        return False, {**gates, "error": str(e), "authDenied": True}

    session.tlog(f"PREFLIGHT setup http={setup.get('http')} ok={setup.get('ok')}")
    ready = wait_ready(session, RECOVERY_READY_TIMEOUT_S)
    gates2 = snapshot_gates(ready)
    gates2["setup"] = {
        "http": setup.get("http"),
        "ok": setup.get("ok"),
        "error": (setup.get("body") or {}).get("error") if isinstance(setup.get("body"), dict) else None,
    }
    if is_hard_abort(ready):
        return False, {
            **gates2,
            "error": f"hard abort after setup: {ready.get('lifecycleState')}",
        }
    if not is_ready(ready):
        return False, {
            **gates2,
            "error": (
                ready.get("productionBlockReason")
                or ready.get("lastError")
                or "still not canStartProduction after Setup"
            ),
        }
    return True, gates2


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.n_cycles < 1:
        print("n_cycles must be >= 1", file=sys.stderr)
        return 2
    if args.max_consecutive_fails < 0:
        print("--max-consecutive-fails must be >= 0", file=sys.stderr)
        return 2

    session = SoakSession(
        args.base_url,
        args.n_cycles,
        args.cycle_timeout_s,
        hang_fail_s=args.hang_fail_s,
        max_consecutive_fails=args.max_consecutive_fails,
    )
    session.tlog(
        f"=== Production start soak ×{session.n_cycles}  runId={session.run_id}  "
        f"base={session.base}  cycleTimeout={session.cycle_timeout_s}s  "
        f"hangFail={session.hang_fail_s}s  maxConsecFails={session.max_consecutive_fails} ==="
    )
    session.tlog(f"Logs: {session.run_dir}")

    try:
        ok_pre, pf = preflight_and_arm(session)
    except AuthDeniedError as e:
        session.tlog(f"ABORT auth: {e}")
        session.write_report(
            {
                "runId": session.run_id,
                "aborted": True,
                "abortReason": str(e),
                "abortKind": "auth",
                "nRequested": session.n_cycles,
                "completed": 0,
                "pass": 0,
                "fail": 0,
                "recovered": 0,
                "finishedAt": now_iso(),
                "sessionLog": str(session.session_log_path),
                "reportPath": str(session.report_path),
            }
        )
        return 2

    if not ok_pre:
        kind = "auth" if pf.get("authDenied") else "preflight"
        session.tlog(f"ABORT {kind}: {pf.get('error')}")
        session.write_report(
            {
                "runId": session.run_id,
                "aborted": True,
                "abortReason": pf.get("error"),
                "abortKind": kind,
                "nRequested": session.n_cycles,
                "completed": 0,
                "pass": 0,
                "fail": 0,
                "recovered": 0,
                "preflight": pf,
                "cycles": [],
                "sessionLog": str(session.session_log_path),
                "reportPath": str(session.report_path),
                "finishedAt": now_iso(),
            }
        )
        return 2

    cycles: list[dict] = []
    pass_n = fail_n = recovered_n = 0
    consecutive_fails = 0
    t_all = time.time()

    for i in range(1, session.n_cycles + 1):
        session.tlog(f"--- CYCLE {i}/{session.n_cycles} ---")
        try:
            rec = run_one_cycle(session, i)
        except AuthDeniedError as e:
            session.tlog(f"ABORT auth during cycle {i}: {e}")
            session.write_report(
                {
                    "runId": session.run_id,
                    "aborted": True,
                    "abortReason": str(e),
                    "abortKind": "auth",
                    "nRequested": session.n_cycles,
                    "completed": i - 1,
                    "pass": pass_n,
                    "fail": fail_n,
                    "recovered": recovered_n,
                    "elapsed_s": round(time.time() - t_all, 1),
                    "preflight": pf,
                    "cycles": cycles,
                    "sessionLog": str(session.session_log_path),
                    "reportPath": str(session.report_path),
                    "finishedAt": now_iso(),
                }
            )
            return 2
        except Exception as e:
            rec = {
                "cycle": i,
                "ok": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "startedAt": now_iso(),
                "finishedAt": now_iso(),
                "hardAbort": False,
                "recovery": None,
                "failReason": "exception",
            }

        if rec.get("hardAbort"):
            fail_n += 1
            cycles.append(rec)
            cycle_path = session.write_cycle(i, rec)
            session.tlog(
                f"FAIL+ABORT cycle={i} lifecycle hard abort err={rec.get('error')} log={cycle_path}"
            )
            session.write_report(
                {
                    "runId": session.run_id,
                    "aborted": True,
                    "abortReason": rec.get("error"),
                    "abortKind": "safety_lockout",
                    "nRequested": session.n_cycles,
                    "completed": i,
                    "pass": pass_n,
                    "fail": fail_n,
                    "recovered": recovered_n,
                    "elapsed_s": round(time.time() - t_all, 1),
                    "preflight": pf,
                    "cycles": cycles,
                    "sessionLog": str(session.session_log_path),
                    "reportPath": str(session.report_path),
                    "finishedAt": now_iso(),
                }
            )
            session.tlog(
                f"=== ABORT safety pass={pass_n} fail={fail_n} completed={i}/{session.n_cycles} ==="
            )
            return 3

        if rec.get("ok"):
            pass_n += 1
            consecutive_fails = 0
            session.tlog(
                f"PASS cycle={i} dur={rec.get('duration_s')}s "
                f"phases={len(rec.get('phases') or [])} job={(rec.get('jobId') or '')[:8]}"
            )
        else:
            fail_n += 1
            consecutive_fails += 1
            session.tlog(
                f"FAIL cycle={i} reason={rec.get('failReason')} result={rec.get('result')} "
                f"status={rec.get('status')} err={rec.get('error')} dur={rec.get('duration_s')}s "
                f"consec={consecutive_fails}"
            )
            session.tlog(f"CYCLE {i} recovering via stop + Setup before next start")
            try:
                recovery = recover_to_ready(session)
            except AuthDeniedError as e:
                rec["recovery"] = {"error": str(e), "authDenied": True}
                cycles.append(rec)
                session.write_cycle(i, rec)
                session.tlog(f"ABORT auth during recovery: {e}")
                session.write_report(
                    {
                        "runId": session.run_id,
                        "aborted": True,
                        "abortReason": str(e),
                        "abortKind": "auth",
                        "nRequested": session.n_cycles,
                        "completed": i,
                        "pass": pass_n,
                        "fail": fail_n,
                        "recovered": recovered_n,
                        "elapsed_s": round(time.time() - t_all, 1),
                        "preflight": pf,
                        "cycles": cycles,
                        "sessionLog": str(session.session_log_path),
                        "reportPath": str(session.report_path),
                        "finishedAt": now_iso(),
                    }
                )
                return 2

            rec["recovery"] = recovery
            if recovery.get("ready"):
                recovered_n += 1
                consecutive_fails = 0
                session.tlog("RECOVERY ok — ready for remaining cycles")
            else:
                session.tlog(f"RECOVERY failed: {recovery.get('error')}")
                final = recovery.get("final") or {}
                if final.get("lifecycle") in HARD_ABORT_LIFECYCLES or final.get("safety"):
                    rec["hardAbort"] = True
                    cycles.append(rec)
                    cycle_path = session.write_cycle(i, rec)
                    session.tlog(f"ABORT after recovery hard abort log={cycle_path}")
                    session.write_report(
                        {
                            "runId": session.run_id,
                            "aborted": True,
                            "abortReason": recovery.get("error") or "safety after recovery",
                            "abortKind": "safety_lockout",
                            "nRequested": session.n_cycles,
                            "completed": i,
                            "pass": pass_n,
                            "fail": fail_n,
                            "recovered": recovered_n,
                            "elapsed_s": round(time.time() - t_all, 1),
                            "preflight": pf,
                            "cycles": cycles,
                            "sessionLog": str(session.session_log_path),
                            "reportPath": str(session.report_path),
                            "finishedAt": now_iso(),
                        }
                    )
                    return 3

                if (
                    session.max_consecutive_fails > 0
                    and consecutive_fails >= session.max_consecutive_fails
                ):
                    cycles.append(rec)
                    cycle_path = session.write_cycle(i, rec)
                    reason = (
                        f"aborted after {consecutive_fails} consecutive fails "
                        f"without successful recovery (last: {recovery.get('error')})"
                    )
                    session.tlog(f"ABORT consecutive fails: {reason}")
                    session.write_report(
                        {
                            "runId": session.run_id,
                            "aborted": True,
                            "abortReason": reason,
                            "abortKind": "consecutive_fails",
                            "nRequested": session.n_cycles,
                            "completed": i,
                            "pass": pass_n,
                            "fail": fail_n,
                            "recovered": recovered_n,
                            "consecutiveFails": consecutive_fails,
                            "elapsed_s": round(time.time() - t_all, 1),
                            "preflight": pf,
                            "cycles": cycles,
                            "sessionLog": str(session.session_log_path),
                            "reportPath": str(session.report_path),
                            "lastCycleLog": str(cycle_path),
                            "finishedAt": now_iso(),
                        }
                    )
                    return 1

        cycles.append(rec)
        cycle_path = session.write_cycle(i, rec)
        session.write_report(
            {
                "runId": session.run_id,
                "nRequested": session.n_cycles,
                "completed": i,
                "pass": pass_n,
                "fail": fail_n,
                "recovered": recovered_n,
                "consecutiveFails": consecutive_fails,
                "elapsed_s": round(time.time() - t_all, 1),
                "preflight": pf,
                "cycles": cycles,
                "sessionLog": str(session.session_log_path),
                "lastCycleLog": str(cycle_path),
            }
        )
        time.sleep(0.4)

    elapsed = round(time.time() - t_all, 1)
    durations = [c.get("duration_s") or 0 for c in cycles if c.get("duration_s")]
    session.write_report(
        {
            "runId": session.run_id,
            "finishedAt": now_iso(),
            "aborted": False,
            "nRequested": session.n_cycles,
            "completed": len(cycles),
            "pass": pass_n,
            "fail": fail_n,
            "recovered": recovered_n,
            "elapsed_s": elapsed,
            "avg_duration_s": round(sum(durations) / max(1, len(durations)), 2) if durations else None,
            "preflight": pf,
            "cycles": cycles,
            "sessionLog": str(session.session_log_path),
            "reportPath": str(session.report_path),
            "cyclesDir": str(session.cycles_dir),
            "hangFailS": session.hang_fail_s,
            "maxConsecutiveFails": session.max_consecutive_fails,
        }
    )
    session.tlog(
        f"=== DONE pass={pass_n} fail={fail_n} recovered={recovered_n} "
        f"completed={len(cycles)}/{session.n_cycles} elapsed={elapsed}s ==="
    )
    session.tlog(f"Report: {session.report_path}")
    session.tlog(f"Session log: {session.session_log_path}")

    if fail_n == 0 and pass_n == session.n_cycles:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
