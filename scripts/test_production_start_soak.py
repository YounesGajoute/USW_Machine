"""The soak must not use Setup to bypass a production authorization hold."""
import unittest
from unittest.mock import patch

import production_start_soak as soak


READY_EXCEPT_GRANT = {
    "referenceLoaded": True,
    "referenceId": "REF-165069",
    "initialized": True,
    "lifecycleState": "RUN",
    "canStartProduction": False,
    "productionBlockReason": soak.PRODUCTION_GRANT_HOLD,
    "productionBlockCode": "VISION_SYNC_COMMISSIONING",
    "productionRunning": False,
    "isProductionActive": False,
    "isSafetyLockout": False,
    "isError": False,
    "connectivity": {"ethercat": {"reachable": True}},
}


class FakeSession:
    def __init__(self, status):
        self.status = status
        self.logs = []

    def get_status(self):
        return self.status

    def tlog(self, message):
        self.logs.append(message)


class ProductionGrantHoldTests(unittest.TestCase):
    def test_clamp_interlock_aborts_preflight_without_setup_or_start(self):
        clamp = {**READY_EXCEPT_GRANT,
                 "productionBlockCode": "CLAMP_TRIGGER_NOT_READY",
                 "productionBlockReason": "Place the cable on the clamps",
                 "clampTriggerMode": "both", "clampRightDi": False, "clampLeftDi": False,
                 "visionSync": {"productionAuthorized": True, "issues": []}}
        session = FakeSession(clamp)
        with patch.object(soak, "run_setup") as setup:
            ok, result = soak.preflight_and_arm(session)
        self.assertFalse(ok)
        self.assertTrue(result["operatorHold"])
        self.assertIn("right DI10=False, left DI9=False", result["error"])
        setup.assert_not_called()
        self.assertEqual(soak.wait_ready(session, 90), clamp)

        # Older backends lack the stable code; the exact operator message still works.
        legacy = {**clamp, "productionBlockCode": None}
        self.assertTrue(soak.operator_action_hold(legacy))

    def test_clamp_interlock_after_stop_never_runs_setup(self):
        clamp = {**READY_EXCEPT_GRANT,
                 "productionBlockCode": "CLAMP_TRIGGER_NOT_READY",
                 "productionBlockReason": "Place the cable on the clamps",
                 "clampTriggerMode": "both", "clampRightDi": False, "clampLeftDi": False,
                 "visionSync": {"productionAuthorized": True, "issues": []}}
        session = FakeSession(clamp)
        with patch.object(soak, "stop_production", return_value={"http": 200}) as stop, \
                patch.object(soak, "run_setup") as setup, \
                patch.object(soak.time, "sleep"):
            result = soak.recover_to_ready(session)
        stop.assert_called_once_with(session)
        setup.assert_not_called()
        self.assertTrue(result["operatorHold"])

    def test_camera_fail_is_not_auto_repeated(self):
        self.assertTrue(soak.inspection_rejected({
            "visionFeedback": {"result": {"outcome": "FAIL"}},
        }))
        self.assertTrue(soak.inspection_rejected({
            "error": "Real-time inspection FAIL: heat-shrink tube missing",
        }))
        self.assertFalse(soak.inspection_rejected({
            "visionFeedback": {"result": {"outcome": "PASS"}},
        }))

    def test_slave_feedback_is_preserved_for_success_and_failed_cycle(self):
        feedback = {"runId": "run-42", "ledgerId": "ledger-7",
                    "result": {"outcome": "FAIL", "welding_splice": {"checks": [
                        {"tool_name": "length", "result": "NG"}]}}}
        self.assertEqual(soak.vision_feedback_from_start({"visionFeedback": feedback}), feedback)
        self.assertEqual(soak.vision_feedback_from_start({"phases": [
            {"phase": "close_clamps"},
            {"phase": "vision_realtime_v2", "inspection": feedback}]}), feedback)

    def test_preflight_aborts_without_setup(self):
        session = FakeSession(READY_EXCEPT_GRANT)
        with patch.object(soak, "run_setup") as setup:
            ok, result = soak.preflight_and_arm(session)
        self.assertFalse(ok)
        self.assertTrue(result["authorizationHold"])
        self.assertIn("Setup cannot issue production grants", result["error"])
        setup.assert_not_called()

    def test_grant_hold_is_reported_even_without_loaded_reference(self):
        session = FakeSession({**READY_EXCEPT_GRANT, "referenceLoaded": False})
        with patch.object(soak, "run_setup") as setup:
            ok, result = soak.preflight_and_arm(session)
        self.assertFalse(ok)
        self.assertTrue(result["authorizationHold"])
        setup.assert_not_called()

    def test_wait_ready_exits_on_grant_hold(self):
        session = FakeSession(READY_EXCEPT_GRANT)
        with patch.object(soak.time, "sleep") as sleep:
            result = soak.wait_ready(session, 180)
        self.assertEqual(result, READY_EXCEPT_GRANT)
        sleep.assert_not_called()

    def test_stable_block_code_works_when_message_changes(self):
        status = {**READY_EXCEPT_GRANT, "productionBlockReason": "localized message"}
        self.assertTrue(soak.production_grant_hold(status))
        for code in ("VISION_SYNC_COMMISSIONING", "VISION_SYNC_RUN_RECONCILIATION_REQUIRED"):
            with self.subTest(code=code):
                session = FakeSession({**status, "productionBlockCode": code})
                with patch.object(soak, "run_setup") as setup:
                    ok, result = soak.preflight_and_arm(session)
                self.assertFalse(ok)
                self.assertTrue(result["authorizationHold"])
                setup.assert_not_called()

    def test_pending_grant_waits_for_slave_acknowledgement(self):
        pending = {**READY_EXCEPT_GRANT,
                   "productionBlockCode": "VISION_SYNC_PRODUCTION_NOT_READY",
                   "productionBlockReason": "Vision Slave production grant is not installed",
                   "visionSync": {"state": "synchronized", "desiredMode": "enabled",
                                  "phase": "ready", "productionAuthorized": False, "issues": []}}
        ready = {**pending, "productionBlockCode": None,
                 "productionBlockReason": None, "canStartProduction": True,
                 "visionSync": {**pending["visionSync"], "productionAuthorized": True}}

        class AdvancingSession(FakeSession):
            def __init__(self):
                super().__init__(pending)
                self.calls = 0

            def get_status(self):
                self.calls += 1
                return pending if self.calls < 3 else ready

        session = AdvancingSession()
        self.assertFalse(soak.production_grant_hold(pending))
        with patch.object(soak.time, "sleep") as sleep:
            result = soak.wait_ready(session, 10)
        self.assertEqual(result, ready)
        self.assertEqual(session.calls, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_run_reconciliation_hold_is_reported_even_when_settings_masks_start_reason(self):
        status = {**READY_EXCEPT_GRANT,
                  "productionBlockCode": None,
                  "productionBlockReason": "Production cannot start while the HMI is on Settings",
                  "visionSync": {"issues": ["UNKNOWN_RUN_OUTCOME_REVIEW_REQUIRED"]}}
        session = FakeSession(status)
        with patch.object(soak, "run_setup") as setup:
            ok, result = soak.preflight_and_arm(session)
        self.assertFalse(ok)
        self.assertTrue(result["authorizationHold"])
        setup.assert_not_called()

    def test_serial_delivery_hold_aborts_without_setup(self):
        status = {**READY_EXCEPT_GRANT,
                  "productionBlockCode": "REFERENCE_SERIAL_NOT_DELIVERED",
                  "productionBlockReason": "Reference was not sent to weld"}
        session = FakeSession(status)
        with patch.object(soak, "run_setup") as setup:
            ok, result = soak.preflight_and_arm(session)
        self.assertFalse(ok)
        self.assertTrue(result["authorizationHold"])
        self.assertIn("Reconnect the correct adapter", result["error"])
        setup.assert_not_called()

    def test_recovery_stops_but_does_not_setup_under_grant_hold(self):
        session = FakeSession(READY_EXCEPT_GRANT)
        with patch.object(soak, "stop_production", return_value={"http": 200}) as stop, \
                patch.object(soak, "run_setup") as setup, \
                patch.object(soak.time, "sleep"):
            result = soak.recover_to_ready(session)
        stop.assert_called_once_with(session)
        setup.assert_not_called()
        self.assertTrue(result["authorizationHold"])
        self.assertFalse(result["ready"])


if __name__ == "__main__":
    unittest.main()
