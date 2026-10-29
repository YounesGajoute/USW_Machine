#!/usr/bin/env python3
"""Report linked AVR application flash (.text + .data), excluding debug sections."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('elf', type=Path)
parser.add_argument('--size-tool', default='avr-size')
parser.add_argument('--baseline', type=int, default=30132)
parser.add_argument('--max-flash', type=int, default=30720)
args = parser.parse_args()
rows = subprocess.check_output([args.size_tool, str(args.elf)], text=True).splitlines()
text, data, bss = map(int, rows[1].split()[:3])
flash = text + data
print(json.dumps({
    'application_flash_bytes': flash,
    'application_limit_bytes': args.max_flash,
    'free_application_bytes': args.max_flash - flash,
    'static_ram_bytes': data + bss,
    'baseline_flash_bytes': args.baseline,
    'saved_bytes': args.baseline - flash,
    'saved_percent': round(100 * (args.baseline - flash) / args.baseline, 3),
}, indent=2))
raise SystemExit(0 if flash <= args.max_flash else 1)
