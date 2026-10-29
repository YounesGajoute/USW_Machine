import unittest
from unittest.mock import patch

import mechanical_inspection_soak as soak


READY = {
    "referenceId": "REF-165069", "referenceLoaded": True, "initialized": True,
    "machineInitialized": True, "lifecycleState": "RUN", "connected": True,
    "connectivity": {name: {"reachable": True} for name in
                     ("vision", "pickPlace", "centring", "ethercat")},
    "pnozConfirmed": True, "airPressureOk": True, "emergencyOk": True,
    "anyDoorOpen": False, "activeFault": None, "isSafetyLockout": False,
    "isError": False, "productionRunning": False, "workerRunning": False,
    "setupInProgress": False, "recoveryInProgress": False, "queueDepth": 0,
    "maintenance": {"active": False}, "visionSync": {"productionAuthorized": True},
    "canStartProduction": False, "productionBlockCode": "CLAMP_TRIGGER_NOT_READY",
    "clampRightDi": False, "clampLeftDi": False,
}


class FakeSession:
    def __init__(self, *args, outcomes=None, **kwargs):
        self.n_cycles = args[1]
        self.cycle_timeout_s = args[2]
        self.run_id = "test"
        self.report_path = "/tmp/test-mechanical-inspection-report.json"
        self.outcomes = outcomes or []
        self.requests = []
        self.records = []
        self.report = None
        self.job_count = 0

    def get_status(self):
        if self.job_count and self.outcomes:
            result = self.outcomes[self.job_count - 1]
            return {**READY, "lastJob": {"jobId": f"job-{self.job_count}",
                                         "status": "completed" if result == "PASS" else "failed",
                                         "cycleResult": result,
                                         "error": None if result == "PASS" else "Real-time inspection FAIL"}}
        return READY

    def api(self, method, path, body=None, timeout=None):
        self.requests.append((method, path, body))
        if path == "/api/machine/mechanical-inspection-cycle":
            self.job_count += 1
            return 202, {"ok": True, "jobId": f"job-{self.job_count}"}
        return 200, {"ok": True}

    def tlog(self, message):
        pass

    def write_cycle(self, number, record):
        self.records.append(record)

    def write_report(self, report):
        self.report = report


class MechanicalInspectionSoakTests(unittest.TestCase):
    def test_clamp_inputs_off_do_not_block_dedicated_test(self):
        self.assertIsNone(soak.test_readiness(READY, "REF-165069"))
        self.assertEqual(soak.test_readiness({**READY, "pnozConfirmed": False}, "REF-165069"),
                         "Safety relay, air, E-stop release, and closed doors are required")
        self.assertEqual(soak.test_readiness(READY, "OTHER"), "Loaded reference changed")

    def test_exact_job_id_required_for_outcome(self):
        status = {**READY, "lastJob": {"jobId": "old", "status": "completed", "cycleResult": "PASS"}}
        self.assertIsNone(soak.exact_job_outcome(status, "new"))
        self.assertEqual(soak.exact_job_outcome(status, "old")["cycleResult"], "PASS")

    def test_no_material_confirmation_never_creates_session(self):
        with patch.object(soak, "SoakSession") as session:
            result = soak.main(["100", "240", "--reference-id", "REF-165069"],
                               session_factory=session)
        self.assertEqual(result, 2)
        session.assert_not_called()

    def test_monitoring_loss_stops_active_test_job(self):
        class LostSession(FakeSession):
            def get_status(self):
                if self.job_count:
                    raise RuntimeError("status unavailable")
                return READY

        session = LostSession("local", 1, 240)
        record = soak.run_cycle(session, 1, "REF-165069")
        self.assertEqual(record["blockKind"], "monitoring_lost")
        self.assertEqual([path for _, path, _ in session.requests],
                         ["/api/machine/mechanical-inspection-cycle", "/api/machine/stop-production"])

    def test_transient_grant_renewal_waits_without_running_setup(self):
        class RenewingSession(FakeSession):
            calls = 0

            def get_status(self):
                self.calls += 1
                if self.calls < 3:
                    return {**READY, "visionSync": {"productionAuthorized": False}}
                return super().get_status()

        session = RenewingSession("local", 1, 240, outcomes=["PASS"])
        with patch.object(soak.time, "sleep"):
            record = soak.run_cycle(session, 1, "REF-165069")
        self.assertTrue(record["ok"])
        self.assertEqual(session.calls, 4)
        self.assertEqual([path for _, path, _ in session.requests],
                         ["/api/machine/mechanical-inspection-cycle"])

    def test_first_inspection_fail_stops_campaign_without_setup_or_normal_start(self):
        session = FakeSession("local", 100, 240, outcomes=["PASS", "FAIL"])
        with patch.object(soak.time, "sleep"):
            result = soak.main(["100", "240", "--reference-id", "REF-165069",
                                "--confirm-material-loaded", "--confirm-operator-and-area-clear"],
                               session_factory=lambda *args, **kwargs: session)
        self.assertEqual(result, 1)
        self.assertEqual(session.job_count, 2)
        self.assertEqual(session.report["pass"], 1)
        self.assertTrue(session.report["aborted"])
        self.assertEqual([path for _, path, _ in session.requests],
                         ["/api/machine/mechanical-inspection-cycle"] * 2)
        self.assertTrue(all(body == {"referenceId": "REF-165069", "confirmMaterial": True}
                            for _, _, body in session.requests))


if __name__ == "__main__":
    unittest.main()
