#!/usr/bin/env python3
"""Reproduce this audit offline. No socket, serial, service or upload operations."""
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RELEASE = ROOT / 'Double_Actuator_Centring_Slave_Firmware/images/version-2.1.1-home-safe'
subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=RELEASE, check=True)
work = Path(tempfile.mkdtemp(prefix='centring-v211-review-'))
with tarfile.open(RELEASE / 'source.tar.gz') as archive:
    # Compatible with this workspace's Python, which predates extraction filters.
    for member in archive.getmembers():
        if not (member.isfile() or member.isdir()):
            raise ValueError(f'Unsupported archive entry: {member.name}')
        (work / member.name).resolve().relative_to(work.resolve())
    archive.extractall(work)
shutil.copytree(HERE / 'fixtures', work / 'tests', dirs_exist_ok=True)

results = []
for name in ['holding_test', 'homing_protocol_test', 'production_command_audit',
             'app_session_audit', 'deep_audit']:
    subprocess.run([
        'g++', '-std=c++17', '-g', '-fsanitize=undefined',
        '-I' + str(work / 'tests/stubs'), '-I' + str(work / 'include'),
        '-I' + str(work / 'src'), str(work / 'tests' / (name + '.cpp')),
        str(work / 'src/kinematics.cpp'), '-o', str(work / name)
    ], check=True)
    result = subprocess.run([str(work / name)], capture_output=True, text=True)
    (work / (name + '.log')).write_text(result.stdout + result.stderr)
    results.append((name, result.returncode))
result = subprocess.run(['python3', str(work / 'tests/direct_client_audit.py')],
                        capture_output=True, text=True)
(work / 'direct_client_audit.log').write_text(result.stdout + result.stderr)
results.append(('direct_client_audit', result.returncode))
for name, code in results:
    print(f'{name}: exit {code}')
print(f'Full logs and extracted release source: {work}')
# These are intended-behavior assertions; the archived release has known failures.
raise SystemExit(1 if any(code for _, code in results) else 0)
