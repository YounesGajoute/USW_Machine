# Production calibration and initialization correction — v2.1.7-cal-departure

The measured endpoints were already applied in v2.1.6 and the persisted backend
configuration. The remaining failures were not a reversed lower servo or an old
endpoint table. Keep these measured settings:

| Setting | Upper | Lower |
|---|---|---|
| HOME / open | 2118 µs | 1545 µs |
| TRAVEL / closed | 1262 µs | 789 µs |
| Servo output | D2 / J1 | D9 / J2 |
| HOME input | D3 / UH | A1 / LH |
| TRAVEL input | D4 / UT | A0 / LT |

Both axes increase pulse width toward HOME and decrease it toward TRAVEL.
Inputs use pull-ups: LOW means pressed/status 1; HIGH means released/status 0.
An asserted destination immediately inhibits further movement into that switch;
seek completion requires stable confirmation. HOME and TRAVEL simultaneously
asserted on the **same** jaw is a fault; both jaws at HOME is valid.

Evidence: `captures/pwm-calibration-20261029T192854Z.json` records a valid upper
cycle (the subsequent lower cycle failed). The separately successful lower
measurement is `captures/lower-jaw/pwm-calibration-20261029T202223Z.json`.
These are commanded pulses at switch edges, not continuous position measurements.

## Corrections

- Gap MOVE departure now uses at most 4 µs per 40 ms while either moving jaw's
  origin remains asserted, with 300 ms initial servo settling. This matches the
  successful calibration rate. Once the origins release, configured gap slew
  resumes. Speeds below this crawl limit remain respected. Both directions use
  the same policy; a stationary peer does not slow the moving jaw.
- The 240 µs origin-release allowance belongs to the continuously asserted
  switch. HOME retries, seek retries and connection interruptions cannot reset
  it. Raw release must also pass debounce before the allowance resets. Exhausted
  retries are rejected before servo attachment, retaining fault pulse evidence.
  Conflict and E-stop handling and immediate destination inhibition remain.
- Backend Initialization acquires an exclusive invocation lock before its first
  asynchronous preflight. Concurrent panel/API requests cannot launch duplicate
  setup sequences. The lock is released on success or failure; initial phase
  publication is also inside session cleanup.

The persisted full calibration retains A=3.97687625, B=-0.176873, C=0.00197035,
sHome=-80, sTravel=35 and mechanical offset 0: at TRAVEL the model contributes
0.2 mm per jaw, giving 0.4 mm minimum total. The full table is host-applied after
Nano restart; its boot placeholder model is not a commissioned calibration.

## Verification and limits

Ten native suites pass under address/undefined-behavior sanitizers. Added cases
exercise independently delayed upper/lower origin releases in both directions,
interrupted departures, repeated commands and release bounce. Existing coverage
checks all 16 electrical input combinations, selected-axis seeks, full calibration,
faults and calibration restoration. The backend concurrency regression and setup
health tests pass; the 14 existing centring test files also pass.

Build: 29,678 / 30,720 application flash bytes; 1,090 / 2,048 static RAM bytes.
Compared with v2.1.6: +382 flash bytes and +6 static RAM bytes.

These checks establish code behavior with simulated feedback. They do not prove
physical servo movement, switch adjustment or electrical noise immunity. Installation
records report passive status/read-back verification separately from powered motion
commissioning. No automatic HOME, SEEK_TRAVEL or MOVE is part of deployment.

## Deployment

Installed 2026-10-29. Full pre-flash backup matched v2.1.6; all 29,678 new
application bytes passed avrdude read-back verification. The backend restarted
with the concurrency fix. Live and persisted calibration matched all four measured
endpoints and the 0.4 mm model. Both HOME inputs were active and both TRAVEL inputs
inactive on the final passive status read. No movement was commanded.

Record: `captures/centring-cal-departure-deployment-20261029T212601Z.json`.
