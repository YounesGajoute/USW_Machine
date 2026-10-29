#!/usr/bin/env python3
"""Offline regression gate. Compiles host executables; never accesses hardware."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
output = Path(tempfile.mkdtemp(prefix='centring-native-'))
suites = ['holding_test', 'homing_protocol_test', 'command_limits_test',
          'app_session_audit', 'safety_regression_test', 'session_integration_test',
          'jaw_paths_test', 'wire_format_test', 'calibration_pwm_test',
          'production_switch_test']
failures = []
for name in suites:
    compile_result = subprocess.run([
        'g++', '-std=c++17', '-Wall', '-Wextra', '-g', '-fsanitize=address,undefined',
        '-I' + str(root / 'tests/stubs'), '-I' + str(root / 'include'),
        '-I' + str(root / 'src'), str(root / 'tests' / (name + '.cpp')),
        str(root / 'src/kinematics.cpp'), '-o', str(output / name)
    ], capture_output=True, text=True)
    log = compile_result.stdout + compile_result.stderr
    code = compile_result.returncode
    if code == 0:
        result = subprocess.run([str(output / name)], capture_output=True, text=True,
                                env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'})
        log += result.stdout + result.stderr
        code = result.returncode
    (output / (name + '.log')).write_text(log)
    print(f'{name}: {"PASS" if code == 0 else "FAIL"}')
    if code:
        failures.append(name)
        print(log)
print(f'{len(suites) - len(failures)}/{len(suites)} suites pass; logs: {output}')
raise SystemExit(bool(failures))
