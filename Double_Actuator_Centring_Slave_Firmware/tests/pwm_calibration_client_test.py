"""Offline host-runner failure tests. Never opens a hardware serial port."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).resolve().parents[1] / 'tools/run_pwm_calibration.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class FakeClock:
    now = 0
    def monotonic(self):
        self.now += 0.01
        return self.now
    def sleep(self, seconds):
        self.now += seconds


class FakeSerial:
    def __init__(self, response, identify=True):
        self.response, self.identify = response, identify
        self.data = bytearray()
        self.commands = []
        self.is_open = False
    def open(self): self.is_open = True
    def close(self): self.is_open = False
    def flush(self): pass
    @property
    def in_waiting(self): return len(self.data)
    def read(self, size):
        # Force fragmentation to exercise buffering across serial timeouts.
        data = self.data[:min(size, 7)]
        del self.data[:len(data)]
        return data
    def write(self, data):
        command = data.decode().strip()
        self.commands.append(command)
        if command == 'INFO' and self.identify:
            self.data.extend(b'INFO calibration-pwm-1.0.4 min=544 max=2400\n')
        if command.startswith(('CAL ', 'LOWER_US ')) or command == 'CHECK_LOWER':
            self.data.extend(self.response.encode())


class RunnerTests(unittest.TestCase):
    def run_case(self, response, identify=True, checking=False, lower_us=None):
        fake = FakeSerial(response, identify)
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(port='/fake', axis='BOTH', upper_home=2102,
                                   lower_home=1538, output=Path(directory), timeout=10, check_lower=checking, lower_us=lower_us)
            with patch.object(runner, 'time', FakeClock()), patch('builtins.print'):
                code = runner.run(args, lambda: fake)
            report = json.loads(next(Path(directory).glob('*.json')).read_text())
            self.assertFalse(fake.is_open)
            return code, report, fake.commands

    def test_complete(self):
        code, report, commands = self.run_case('OK CAL\nEDGE axis=U end=TRAVEL us=1266\n'
            'RESULT ok=1 mask=3 upper_valid=1 lower_valid=1 hu=2102 tu=1266 hl=1538 tl=742 reason=ok\n')
        self.assertEqual(code, 0)
        self.assertTrue(report['ok'])
        self.assertEqual(report['edges'][0]['us'], '1266')
        self.assertIn('PING', commands)

    def test_check_lower_edge(self):
        code, report, commands = self.run_case('CHECK_RESULT ok=1 pl=1800 lh=1 lt=0 attached=-1 reason=home_pressed\n', checking=True)
        self.assertEqual(code, 0)
        self.assertIn('CHECK_LOWER', commands)
        self.assertIsNone(report['home_seeds_us'])

    def test_check_lower_no_edge(self):
        code, _, _ = self.run_case('CHECK_RESULT ok=1 pl=544 lh=0 lt=0 attached=-1 reason=range_end_no_home_change\n', checking=True)
        self.assertEqual(code, 1)

    def test_check_lower_active_home(self):
        code, report, _ = self.run_case('CHECK_RESULT ok=0 pl=2400 lh=1 lt=0 attached=-1 reason=home_active_at_start\n', checking=True)
        self.assertEqual(code, 1)
        self.assertEqual(report['result']['reason'], 'home_active_at_start')

    def test_lower_position(self):
        code, report, commands = self.run_case('POSITION_RESULT ok=1 pl=853 lh=0 lt=0 attached=-1 reason=pulse_complete\n', lower_us=853)
        self.assertEqual(code, 0)
        self.assertIn('LOWER_US 853', commands)
        self.assertEqual(report['measurement'], 'commanded pulse; no measured angle')

    def test_lower_position_contact(self):
        code, report, _ = self.run_case('POSITION_RESULT ok=0 pl=853 lh=1 lt=0 attached=-1 reason=home_contact\n', lower_us=853)
        self.assertEqual(code, 1)
        self.assertEqual(report['result']['reason'], 'home_contact')

    def test_lower_position_wrong_pulse(self):
        code, _, _ = self.run_case('POSITION_RESULT ok=1 pl=1500 lh=0 lt=0 attached=-1 reason=pulse_complete\n', lower_us=853)
        self.assertEqual(code, 1)

    def test_partial_result_fails(self):
        code, report, _ = self.run_case('RESULT ok=1 mask=3 upper_valid=1 lower_valid=0\n')
        self.assertEqual(code, 1)
        self.assertFalse(report['ok'])

    def test_fault(self):
        code, report, _ = self.run_case('FAULT axis=U reason=origin_stuck\n'
                                       'RESULT ok=0 mask=3 upper_valid=0 lower_valid=0 reason=origin_stuck\n')
        self.assertEqual(code, 1)
        self.assertEqual(report['result']['reason'], 'origin_stuck')

    def test_reset_stops(self):
        code, report, commands = self.run_case('READY calibration-pwm-1.0.4\n')
        self.assertEqual(code, 1)
        self.assertIn('reset', report['error'])
        self.assertEqual(commands[-1], 'STOP')

    def test_no_response_stops(self):
        code, report, commands = self.run_case('')
        self.assertEqual(code, 1)
        self.assertIn('timed out', report['error'])
        self.assertEqual(commands[-1], 'STOP')

    def test_wrong_firmware_never_moves(self):
        code, _, commands = self.run_case('', identify=False)
        self.assertEqual(code, 1)
        self.assertEqual(commands, ['INFO'])

    def test_rejected_start(self):
        code, report, commands = self.run_case('ERR start_requires_home\n')
        self.assertEqual(code, 1)
        self.assertIn('start_requires_home', report['error'])
        self.assertEqual(commands[-1], 'STOP')


if __name__ == '__main__':
    unittest.main()
