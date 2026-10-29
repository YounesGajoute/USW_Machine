#!/usr/bin/env python3
"""Compare motion/wire traces against archived v2.1.4; never opens hardware."""
import argparse
import filecmp
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', type=Path, default=root / 'images/version-2.1.4-jaw-feedback/source.tar.gz')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
output = args.output or Path(tempfile.mkdtemp(prefix='centring-compat-'))
output.mkdir(parents=True, exist_ok=True)
baseline = output / 'baseline'
# Extract only regular source/header files, without following archive links.
with tarfile.open(args.baseline) as archive:
    for member in archive.getmembers():
        path = Path(member.name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe baseline path')
        if member.isfile() and path.parts[0] in ('src', 'include'):
            target = baseline / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())

report = {'baseline_archive_sha256': hashlib.sha256(args.baseline.read_bytes()).hexdigest(), 'traces': {}}
for name, source in [('baseline', baseline), ('optimized', root)]:
    executable = output / name / 'trace'
    executable.parent.mkdir(exist_ok=True)
    subprocess.run([
        'g++', '-std=c++17', '-O2', '-I' + str(root / 'tests'),
        '-I' + str(root / 'tests/stubs'), '-I' + str(source / 'include'),
        '-I' + str(source / 'src'), str(root / 'tests/compatibility_trace.cpp'),
        str(source / 'src/kinematics.cpp'), '-o', str(executable),
    ], check=True)
    trace = output / (name + '.trace')
    with trace.open('wb') as stream:
        subprocess.run([str(executable)], stdout=stream, check=True)
    data = trace.read_bytes()
    report['traces'][name] = {'bytes': len(data), 'lines': data.count(b'\n'),
                              'sha256': hashlib.sha256(data).hexdigest()}
report['identical'] = filecmp.cmp(output / 'baseline.trace', output / 'optimized.trace', shallow=False)
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
print('Artifacts:', output)
raise SystemExit(0 if report['identical'] else 1)
