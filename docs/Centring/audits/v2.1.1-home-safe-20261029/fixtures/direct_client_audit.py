"""Offline audit of the standalone tester; never creates a network connection."""
import sys
import unittest
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from slave_tcp import SlaveTcp


class FakeClient(SlaveTcp):
    def __init__(self, frames):
        super().__init__(host="127.0.0.1", verbose=False)
        self.frames = deque(frames)
        self.sent = []

    def connect(self):
        raise AssertionError("This audit must never open a socket")

    def send_raw(self, text):
        self.sent.append(text)

    def _readline(self, timeout=1):
        if self.frames:
            return self.frames.popleft()
        raise TimeoutError("No matching response in simulated stream")

    def drain(self, idle_s=0.15):
        return []

    def keepalive_if_needed(self, every_s=5):
        pass


def status(command, busy=0):
    return f"u=-80 l=-80 h=62.87 accepted=1 busy={busy} cal=1 estop=0 lastCmd={command} moveEnd=ok"


class DirectClientAudit(unittest.TestCase):
    def test_matching_command_completes(self):
        client = FakeClient([status("HOME_UPPER", 1), status("HOME_UPPER")])
        result, _, _ = client.command("HOME_UPPER")
        self.assertEqual(result.get("lastCmd"), "HOME_UPPER")
        self.assertEqual(client.sent, ["HOME_UPPER"])

    def test_unrelated_ping_cannot_complete_home(self):
        client = FakeClient([status("PING")])
        with self.assertRaises((TimeoutError, RuntimeError, ConnectionError)):
            client.command("HOME_UPPER")

    def test_restart_banner_aborts_uncertain_motion(self):
        client = FakeClient([status("HOME_UPPER", 1), "READY", "PING", status("HOME_UPPER")])
        with self.assertRaises((TimeoutError, RuntimeError, ConnectionError)):
            client.command("HOME_UPPER")


if __name__ == "__main__":
    unittest.main(verbosity=2)
