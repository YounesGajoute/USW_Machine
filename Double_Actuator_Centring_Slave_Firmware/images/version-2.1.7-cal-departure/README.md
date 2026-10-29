# v2.1.7-cal-departure

Measured endpoints: upper HOME 2118 / TRAVEL 1262 µs, lower HOME 1545 / TRAVEL 789 µs.
HOME opens (+µs), TRAVEL closes (−µs); active-low switches retain the measured pin map.

Gap moves depart asserted origins at the calibration crawl rate. A continuously
asserted origin retains its 240 µs allowance across retries and interruptions;
exhausted retries do not reattach PWM. Backend Initialization now locks before
asynchronous preflight to prevent overlapping setup sequences.

29,678 bytes flash; 1,090 bytes static RAM. Ten native suites, 14 existing centring
test files and two setup test files pass. See verification/ and
../../../docs/Centring/PRODUCTION_CALIBRATION_DEPARTURE_CORRECTION.md.

Host calibration is mandatory after restart. centring_config.json preserves the
0.4 mm minimum model and zero offset. Deployment status is recorded separately
in manifest.json/deployment.json. Powered motion commissioning is not implied.
