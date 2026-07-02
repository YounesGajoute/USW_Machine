#!/usr/bin/env python3
"""Lower module (J2) only — switch IDs and servo direction test.

Requires centring_nano_bench firmware:
  py -m platformio run -e centring_nano_bench -t upload

Run (close Serial Monitor first):
  py scripts/bench_lower_test.py
  py scripts/bench_lower_test.py --auto
  py scripts/bench_lower_test.py --monitor-only

Manual serial:
  INPUTS_LOWER
  MONITOR_LOWER
  SWEEP_LOWER HOME
  SWEEP_LOWER TRAVEL
  TEST_LOWER
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    sys.argv = [str(root / "scripts" / "bench_switch_test.py"), "--lower-only", *sys.argv[1:]]
    runpy.run_path(str(root / "scripts" / "bench_switch_test.py"), run_name="__main__")
