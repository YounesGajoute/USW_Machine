# Application flash optimization — v2.1.5-flash-opt

Measured on 2026-10-29 against the deployed v2.1.4-jaw-feedback source/image.
The optimized application preserves all commands, status fields, the calibrated
quadratic model, motion phases, safety checks, watchdog and Ethernet behavior.

| Linked memory | v2.1.4 | Optimized | Change |
|---|---:|---:|---:|
| Application flash, `.text + .data` | 30,132 B | 28,636 B | −1,496 B (4.965%) |
| Free application flash out of 30,720 B | 588 B | 2,084 B | +1,496 B |
| Static SRAM, `.data + .bss` | 1,092 B | 1,084 B | −8 B |

This is the smallest validated final candidate from this investigation, not a
claim of a mathematical global minimum. ELF file size includes debug metadata
and is not application flash usage. The bootloader reservation remains intact.

## Findings and changes

The baseline already used `-Os`, LTO, section garbage collection, shared AVR
prologues, static-IP Ethernet, disabled UDP/DNS/client connect paths, and removal
of unused USB Serial code. Those large savings cannot be counted again here.

The largest baseline linked symbols included `main` (7,524 B, with substantial
application code inlined), `uip_process` (2,592 B), Ethernet tick (1,056 B), inverse
height/pulse conversion (862 B), STATUS (822 B), and numeric formatting (546 B).
LTO folds helpers into callers, so these are symbols, not complete subsystem totals.

1. The decimal formatter now converts the rounded integer once with `ultoa`,
   then inserts decimal padding/separators. It preserves two-decimal STATUS and
   trimmed six-decimal CAL_RESULT formatting, rounding, signs and clamps. Its
   linked body falls from 546 to 400 B; local character buffers fall from 26 to
   11 bytes. Stack high-water savings have not been measured on hardware.
2. SETCAL parses directly into its uncommitted candidate, eliminating temporary
   model values and a redundant calibration-ID buffer/copy. Failed parsing still
   leaves the active calibration unchanged. Known command tokens are copied once.
3. HOME/SEEK dispatch shares axis selection. STATUS and CAL_RESULT share endpoint
   serialization. Start-rejection/wire-reason IDs use a checked direct mapping;
   compile-time assertions prevent future enum drift.
4. Four calibration-phase setup functions share one implementation with identical
   phase-specific resets and clock updates. Selected helpers/command handlers are
   explicitly not inlined where measurements showed smaller total code.
5. Pulse normalization clamps endpoint/out-of-range values before subtraction,
   replacing signed 32-bit intermediates with unsigned 16-bit differences. The
   accepted-calibration invariant HOME > TRAVEL and suspended zero ends are retained.
6. The pinned AVR compiler produces smaller code with `-fno-split-wide-types`,
   `-fno-move-loop-invariants`, `-mstrict-X`, and `-fno-tree-loop-optimize`.
   These were measured together with the final source. No fast-math, integer ABI
   changes, reduced precision, removed fault checks or reduced network capacity
   were used.

## Measurement history

78 compiler/helper variants were measured, plus successive source refactors and
a final clean build. Results are preserved in the version's `verification/`
directory. Globally disabling inlining, disabling cross-jumping, several other
optimization switches and most forced helper boundaries were rejected because
they grew flash or provided no improvement. These gains depend on the pinned
compiler and source; reevaluate them after a toolchain upgrade.

| Retained stage | Flash bytes |
|---|---:|
| Baseline | 30,132 |
| Decimal formatting, SETCAL temporaries, command dispatch | 29,826 |
| Shared calibration setup and pulse normalization | 29,774 |
| Measured compiler combination | 29,290 |
| Selected shared function bodies | 28,734 |
| Final loop-optimization setting | 28,714 |
| Shared endpoint output and checked reason mapping | 28,668 |
| Remove remaining redundant token copies | 28,636 |

These are sequential measurements, not independently additive per-function gains.

## Validation and reproduction

- Eight native regression suites pass under AddressSanitizer and UBSan, including
  HOME/MOVE/SEEK/CALIBRATE, stuck/both-limit feedback, hold supervision, speed,
  overflow bounds, session replacement and truncated network replies.
- Decimal formatting passes 40,056 cases, including rounding, leading/trailing
  zeros, signed values, clamps, infinities and NaNs.
- Differential execution against the archived v2.1.4 source produces exactly
  identical 6,499,579-byte / 233,585-line traces. These include 104 motion/fault
  scenarios, every 16-bit pulse on both axes for three calibration states, and
  10,000 pairs of wire-format values. SHA-256 for both traces:
  `d7db3b91c300da2fc71c7bc9cc368bb469c797a4af1b73befc8196c2ad6c2f00`.
- The eleven-file backend centring regression suite passes.
- A clean AVR build passes with atmelavr 5.3.0, AVR GCC 7.3.0, Servo 1.3.0 and
  EthernetENC 2.0.5, and confirms the memory figures above.

From this firmware directory:

```sh
pio run -e double_actuator_centring_slave
python3 tests/run_native_tests.py
python3 tests/run_compatibility.py
python3 scripts/measure_flash.py .pio/build/double_actuator_centring_slave/firmware.elf --size-tool /path/to/avr-size
```

On the development host, PlatformIO uses the isolated writable core at
`/tmp/centring-pio-core`; the existing build helper patches cached Ethernet/core
sources. Use an isolated core when reproducing this build beside other projects.

The native tests are simulations, not proof of physical jaw travel, real-time
Ethernet timing, or maximum stack depth. The v2.1.4 lower-HOME discrepancy and
the unreachable 2-mm recipe remain separate commissioning issues. Existing
parser/model audit findings are not silently changed by this size optimization.
Further major reductions would require broader redesign or feature tradeoffs;
this build retains the Servo implementation, TCP stack and full quadratic model.

Firmware image, exact production source, changes relative to v2.1.4, verification
evidence and checksums are saved in `images/version-2.1.5-flash-opt/`. Deployment,
if performed, is recorded separately in that version's README and `captures/`.
