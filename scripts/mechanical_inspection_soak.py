#!/usr/bin/env python3
"""Repeated mechanical-and-camera test cycles, with process outputs guarded off.

This uses /api/machine/mechanical-inspection-cycle, not the normal production
Start endpoint. Clamp trigger inputs may remain off. The backend still checks
doors, E-stop, air, PNOZ, reference binding and the Vision run grant.

Example (only after material is physically loaded and an operator is present):
  python3 scripts/mechanical_inspection_soak.py 100 240 --reference-id REF-165069 \
    --confirm-material-loaded --confirm-operator-and-area-clear
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from production_start_soak import AuthDeniedError, SoakSession, now_iso, snapshot_gates


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("n_cycles", type=int, nargs="?", default=100)
    parser.add_argument("cycle_timeout_s", type=float, nargs="?", default=240)
    parser.add_argument("--base-url", default="http://127.0.0.1:3333")
    parser.add_argument("--reference-id", required=True, help="Exact loaded reference ID")
    parser.add_argument("--confirm-material-loaded", action="store_true")
    parser.add_argument("--confirm-operator-and-area-clear", action="store_true")
    return parser.parse_args(argv)


def test_readiness(status: dict, reference_id: str) -> str | None:
    """Test-mode gates. Normal production's clamp gate is deliberately irrelevant."""
    if status.get("referenceId") != reference_id or status.get("referenceLoaded") is not True:
        return "Loaded reference changed"
    if status.get("initialized") is not True or status.get("machineInitialized") is not True:
        return "Initialize the loaded reference before the test"
    if status.get("lifecycleState") not in ("RUN", "IDLE"):
        return f"Machine lifecycle is {status.get('lifecycleState')}"
    if not status.get("connected") or any(
        (status.get("connectivity") or {}).get(name, {}).get("reachable") is not True
        for name in ("vision", "pickPlace", "centring", "ethercat")
    ):
        return "A machine subsystem is disconnected"
    if (status.get("pnozConfirmed") is not True or status.get("airPressureOk") is not True
            or status.get("emergencyOk") is not True or status.get("anyDoorOpen") is not False):
        return "Safety relay, air, E-stop release, and closed doors are required"
    if status.get("activeFault") or status.get("isSafetyLockout") or status.get("isError"):
        return "Clear the machine fault before the test"
    for flag in ("productionRunning", "workerRunning", "setupInProgress", "recoveryInProgress"):
        if status.get(flag) is not False:
            return f"Machine is busy ({flag})"
    if status.get("queueDepth") != 0 or (status.get("maintenance") or {}).get("active") is not False:
        return "Machine queue or maintenance mode is active"
    if (status.get("visionSync") or {}).get("productionAuthorized") is not True:
        return "Vision Slave is not authorized for the loaded reference"
    return None


def exact_job_outcome(status: dict, job_id: str) -> dict | None:
    """Never credit a previous test or a different production job."""
    last = status.get("lastJob") or {}
    if last.get("jobId") == job_id and last.get("status") in ("completed", "failed", "cancelled"):
        return last
    for job in status.get("recentJobs") or []:
        if job.get("id") == job_id and job.get("status") in ("completed", "failed", "cancelled"):
            return {"jobId": job_id, **job}
    return None


def run_cycle(session: SoakSession, number: int, reference_id: str) -> dict:
    record = {"cycle": number, "startedAt": now_iso(), "jobId": None, "status": None,
              "result": None, "error": None, "ok": False, "phases": []}
    # A 10-second Vision grant can be briefly absent during renewal. Wait for
    # that one transient state; never wait through a safety or reference fault.
    grant_deadline = time.monotonic() + 15
    while True:
        status = session.get_status()
        block = test_readiness(status, reference_id)
        if block != "Vision Slave is not authorized for the loaded reference" or time.monotonic() >= grant_deadline:
            break
        time.sleep(0.25)
    if block:
        record.update(error=block, blockKind="preflight", final=snapshot_gates(status))
        return record

    code, body = session.api("POST", "/api/machine/mechanical-inspection-cycle",
                             {"referenceId": reference_id, "confirmMaterial": True}, timeout=15)
    if code != 202 or not isinstance(body, dict) or not body.get("ok") or not body.get("jobId"):
        record.update(error=(body or {}).get("error") if isinstance(body, dict) else str(body),
                      blockKind="start_rejected", startHttp=code)
        return record
    job_id = str(body["jobId"])
    record["jobId"] = job_id
    session.tlog(f"CYCLE {number} mechanical-inspection job={job_id}")
    deadline = time.monotonic() + session.cycle_timeout_s
    try:
        while time.monotonic() < deadline:
            status = session.get_status()
            outcome = exact_job_outcome(status, job_id)
            if outcome:
                record.update(status=outcome.get("status"), result=outcome.get("cycleResult"),
                              error=outcome.get("error"), finishedAt=now_iso(), final=snapshot_gates(status))
                record["ok"] = record["status"] == "completed" and record["result"] == "PASS"
                record["blockKind"] = None if record["ok"] else "inspection_or_motion_failed"
                if record["ok"]:
                    # lastJob is published just before the queue worker releases
                    # ownership. Do not make the next request in that small gap.
                    while (status.get("workerRunning") or status.get("productionRunning")
                           or status.get("queueDepth")) and time.monotonic() < deadline:
                        time.sleep(0.2)
                        status = session.get_status()
                    if status.get("workerRunning") or status.get("productionRunning") or status.get("queueDepth"):
                        record.update(ok=False, error="Job finished but machine did not become idle",
                                      blockKind="not_idle")
                return record
            if status.get("lifecycleState") in ("SAFETY_LOCKOUT", "POWER_OFF"):
                record.update(error=f"Safety stop: {status.get('lifecycleState')}", blockKind="safety",
                              final=snapshot_gates(status))
                return record
            phase = status.get("productionPhase")
            if phase and phase not in record["phases"]:
                record["phases"].append(phase)
            time.sleep(0.2)
    except Exception as error:
        # The job may still be moving even if status polling fails. Request a
        # stop and never submit another test job with an uncertain outcome.
        session.api("POST", "/api/machine/stop-production", {}, timeout=30)
        record.update(error=f"Lost job monitoring: {error}", blockKind="monitoring_lost",
                      finishedAt=now_iso())
        return record
    record.update(error=f"Job {job_id} did not finish within {session.cycle_timeout_s}s",
                  blockKind="timeout", finishedAt=now_iso())
    return record


def main(argv=None, session_factory=SoakSession) -> int:
    args = parse_args(argv)
    if args.n_cycles < 1 or args.cycle_timeout_s <= 0:
        print("Cycle count and timeout must be positive", file=sys.stderr)
        return 2
    if not args.confirm_material_loaded or not args.confirm_operator_and_area_clear:
        print("Test material, an operator, and a clear work area must be confirmed; no cycle started.", file=sys.stderr)
        return 2

    session = session_factory(args.base_url, args.n_cycles, args.cycle_timeout_s,
                              hang_fail_s=0, max_consecutive_fails=0)
    session.tlog(f"=== Mechanical-and-camera soak x{args.n_cycles} reference={args.reference_id} "
                 "external process outputs off; stop on first FAIL ===")
    records = []
    try:
        for number in range(1, args.n_cycles + 1):
            record = run_cycle(session, number, args.reference_id)
            records.append(record)
            session.write_cycle(number, record)
            session.tlog(f"CYCLE {number}: {'PASS' if record['ok'] else 'STOP'} "
                         f"result={record.get('result')} error={record.get('error')}")
            if not record["ok"]:
                if record.get("blockKind") == "timeout":
                    # Stop only the exact test we started; never enqueue another cycle.
                    session.api("POST", "/api/machine/stop-production", {}, timeout=30)
                break
    except (AuthDeniedError, RuntimeError) as error:
        records.append({"cycle": len(records) + 1, "ok": False, "error": str(error),
                        "blockKind": "api_error"})
        session.tlog(f"STOP: {error}")

    passed = sum(record.get("ok") is True for record in records)
    complete = passed == args.n_cycles
    session.write_report({"runId": session.run_id, "mode": "mechanical-inspection-cycle",
                          "referenceId": args.reference_id, "nRequested": args.n_cycles,
                          "completed": len(records), "pass": passed, "aborted": not complete,
                          "abortReason": None if complete else records[-1].get("error"),
                          "externalProcessTriggered": False, "cycles": records,
                          "finishedAt": now_iso()})
    session.tlog(f"REPORT {session.report_path} pass={passed}/{args.n_cycles}")
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
