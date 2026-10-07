# Version 2 centring — height calibration

Status: **host and HMI implemented. Nano firmware must be uploaded** before a pulse-end cycle can record a live pulse. Production centring on the machine is still Version 1 until that firmware is on the Nano.

This document is only the height-calibration part of Version 2. The rest of the centring contract is [VERSION_2_PHASE_REQUIREMENTS.md](./VERSION_2_PHASE_REQUIREMENTS.md). The Nano commands that page uses (`CALDRV`, `SETCAL`, `pu` / `pl`) are specified in [VERSION_2_NANO_FIRMWARE.md](./VERSION_2_NANO_FIRMWARE.md).

---

## Purpose

Height calibration gives the centring system the relation it needs between:

- pulse width (µs), commanded to the servo
- soft angle (degrees), computed from that pulse
- opening of one jaw (mm)

The servos have no position sensor. Without this relation the host cannot name H_PRE or H_POST, and it cannot send a move to `h_pre_mm` or `h_post_mm`.

Calibration is **data**. It is not one production command, and it is not tied to `HOME` or `SEEK_TRAVEL`. Those two commands stop on switches. The height commands use the data.

The US Machine HMI is where a Bypass user measures a new set of pulse ends and, separately, a new quadratic millimetre curve. Pulse ends are driven and saved one jaw and one switch at a time. The operator procedure is [PULSE_ENDS_CALIBRATION_UX.md](./PULSE_ENDS_CALIBRATION_UX.md).

---

## Architecture

The host stores the relation. The Nano keeps a copy in RAM and loses it at every power loss. After power loss, initialization sends the stored copy with `SETCAL` once the jaws are at HOME.

```text
Bypass user
  → Settings → Height calibration
  → Pulse ends, Quadratic curve, slaveCal, or Manual move
  → POST /api/centring/v2/height-calibration/...
  → host checks the numbers, saves slaveCal, SETCAL to the Nano
```

| Layer | Role |
|-------|------|
| HMI | Four tabs: Pulse ends, Quadratic curve, slaveCal, and Manual move. Confirmation before motion. Loading, success, and failure. |
| API | Bypass only. Resource routes under `/api/centring/v2/height-calibration`. |
| Host math | Validates pulse ends. Fits or places the quadratic. |
| Nano `CALDRV` | Version 2 switch drive used only to put a jaw on HOME or TRAVEL while measuring. |
| Nano `SETCAL` | Loads a relation the host already validated. Reused from Version 1. |
| Nano height model | `h = A + B·angle + C·angle²`. Reused from Version 1. |

UI code: `frontend/src/components/settings/sections/HeightCalibrationSection.tsx`.

Host code: `backend/lib/centringHeightCalibration.mjs`, `backend/lib/centringHeightCalibrationService.mjs`.

### Access

Only the role **BYPASS** can open the pages and call the API. Operator, Quality, Maintenance, and Admin receive 403. The section is Settings → **Height calibration**. It is not on the production sidebar.

### What is not this calibration

| Item | Why it is separate |
|------|--------------------|
| Version 1 `CALIBRATE` / `POST /api/centring/calibrate` | That crawl is not the Version 2 measurement. |
| Production `HOME` and `SEEK_TRAVEL` | Same names as Version 1. Their production workflow is not the calibration drive. |
| `h_pre_mm` and `h_post_mm` | Recipe openings for a shrink tube. They are targets, not calibration. |
| The 1.5 s pulse at Start | Production behaviour (§7.3 of the requirements). It uses a calibration that already exists. |

---

## The two layers

### 1. Pulse ends — measured on the machine

Each jaw has two pulses:

| Symbol | Axis | Switch | Direction |
|--------|------|--------|-----------|
| `hu` | Upper | HOME (open end) | Higher microseconds |
| `tu` | Upper | TRAVEL (close end) | Lower microseconds |
| `hl` | Lower | HOME | Higher microseconds |
| `tl` | Lower | TRAVEL | Lower microseconds |

Fraction `t` along an axis is 0 at its HOME pulse and 1 at its TRAVEL pulse:

```text
t = (pulse_HOME − pulse) / (pulse_HOME − pulse_TRAVEL)
```

Rules before anything is stored:

- `hu > tu` and `hl > tl`
- each span at least 80 µs
- every pulse inside 544–2400 µs

Cold-boot placeholders (not valid until replaced): upper 1950 / 1100 µs, lower 1501 / 731 µs.

### 2. Quadratic millimetre curve

One jaw’s opening at soft angle `s` is:

```text
h = A + B·s + C·s²
```

| Symbol | Version 1 default | Meaning |
|--------|-------------------|---------|
| `sHome` | −80° | Soft angle label at the HOME pulse |
| `sTravel` | +35° | Soft angle label at the TRAVEL pulse |
| `A`, `B`, `C` | 4.67687625, −0.176873, 0.00197035 | Curve coefficients. `C` may be negative when the opening still falls from `sHome` to `sTravel` |
| `hHome` | about 31.44 mm | Opening of **one** jaw at `sHome` |
| `hTravel` | about 0.90 mm | Opening of **one** jaw at `sTravel` |

`sHome` and `sTravel` are not switch readings. They are the angle labels the Nano reports in STATUS `u=` and `l=`. A pulse between the ends is:

```text
angle = sHome + t · (sTravel − sHome)
```

Total opening of both jaws is:

```text
H = h(upper) + h(lower) + mechOff
```

`hHome` must be greater than `hTravel`. With both jaws at HOME and `mechOff = 0`, total opening is about 62.9 mm. With both at TRAVEL it is about 1.8 mm.

`SETCAL` stores `A`, `B`, `C`, `sHome`, and `sTravel` with the four pulses. The Nano rejects the line unless `sTravel > sHome`, the HOME height is greater than the TRAVEL height, and the opening falls steadily between those angles. `C` may be negative when that fall is still strict. A curve that rises anywhere on the stroke is rejected, because one opening would then be two jaw positions.

---

## Pulse-end cycle

Page: **Pulse ends**. Operator procedure: [PULSE_ENDS_CALIBRATION_UX.md](./PULSE_ENDS_CALIBRATION_UX.md).

The page does not run the four drives as one cycle. The Bypass user drives one jaw to one switch, checks that switch, and saves that pulse. Upper and lower are separate. Open and closed are separate.

| Position | Command | Save when | Saved as |
|----------|---------|-----------|----------|
| Upper open | `CALDRV OPEN U` | Upper HOME switch is pressed | `hu` |
| Upper closed | `CALDRV CLOSE U` | Upper TRAVEL switch is pressed | `tu` |
| Lower open | `CALDRV OPEN L` | Lower HOME switch is pressed | `hl` |
| Lower closed | `CALDRV CLOSE L` | Lower TRAVEL switch is pressed | `tl` |

`CALDRV` steps the pulse 4 µs every 20 ms.

- `OPEN` increases the pulse and stops on the HOME switch.
- `CLOSE` decreases the pulse and stops on the TRAVEL switch.
- If that switch is already pressed, the drive does not take another step. Save still records the commanded pulse.
- The other switch does not stop the drive.
- The pulse is not rewritten from the switch bits for this drive.
- If the pulse reaches the firmware rail without the switch, or 60 seconds pass, the drive fails and that position is not saved.

The live pulse is STATUS `pu` (upper) and `pl` (lower). **Save** re-reads that pulse and accepts it only while the named switch is still pressed and the value is inside 544–2400 µs. **Apply four pulses** validates `hu > tu` and `hl > tl` with at least 80 µs of span, keeps the current curve coefficients, saves `slaveCal` on the host, and sends `SETCAL`.

Applying pulse ends does not by itself change `A`, `B`, `C`, `sHome`, or `sTravel`. `SETCAL` does not move the jaws.

---

## Quadratic-curve cycle

Page: **Quadratic curve**.

The page plots the current curve from `sHome` to `sTravel` and shows `A`, `B`, `C`, the angle labels, and the per-jaw heights at the two ends.

Creating a new curve needs the jaws at known poses and a measured **total** opening typed in millimetres. The per-jaw sample is half of that total.

| Step | Drive | Sample angle | What you type |
|------|-------|--------------|---------------|
| 1 | `CALDRV OPEN BOTH` | `sHome` (−80° unless a saved curve says otherwise) | Total opening at HOME, mm |
| 2 | `CALDRV CLOSE BOTH` | `sTravel` (+35° unless a saved curve says otherwise) | Total opening at TRAVEL, mm |
| 3–6 | `MOVEBOTHMM` to the opening the stored curve gives at 20%, 40%, 60%, and 80% of the soft-angle stroke | The soft angle STATUS reports after that move (`u` and `l`) | Total opening at that pose, mm |

The four middle drives are four different heights. On the default curve they are about 42 mm, 26 mm, 14 mm, and 6 mm total. The page stores the soft angle STATUS reports after the jaws stop.

The Nano still stores one quadratic, `h = A + B·s + C·s²`. Six gauge points determine those three numbers by least squares. A fourth coefficient would need a new inverse and a new `SETCAL` line. The host fits the samples in a centered angle so the extra points stay numerically stable.

Then **Build curve**:

- **Two ends and four middle samples.** A new `A`, `B`, and `C` are fitted. The opening must fall steadily from HOME to TRAVEL, the four middle openings must be separated in angle and in height, and the quadratic must miss no sample by more than 1.5 mm per jaw. `C` may be negative when the fall is still strict.
- **Two samples** (HOME and TRAVEL only). The curve is placed on those two measured per-jaw heights and the existing curvature `C` is kept. `sHome` and `sTravel` stay as they are. The placed curve must still fall from HOME to TRAVEL.

**Apply curve** is refused until pulse ends have already been saved. It writes `A`, `B`, `C`, `sHome`, and `sTravel` into the same `slaveCal` record and sends `SETCAL`. The four pulses are left as last applied.

Each middle move uses the curve that is already on the Nano, only to place the jaws. The number you type is the measurement. It replaces that curve when you apply.

---

## slaveCal, SETCAL, carriage, and backup

The third HMI tab, **slaveCal**, is the record the height moves use.

The fourth tab, **Manual move**, steps servos by raw pulse with the wire command `NUDGE`, shows live limit-switch and E-stop latch lamps, and can copy live `pu` / `pl` into `hu`, `tu`, `hl`, and `tl` before the existing pulse-end apply. A nudge does not stop when a switch presses and does not require `cal=1`. Production and the quadratic-curve tab still use `MOVE_UPPERMM`, `MOVE_LOWERMM`, and `MOVEBOTHMM`; those moves still cannot pose a jaw outside the saved height model.

| Item | What the page shows |
|------|---------------------|
| `slaveCal` | `calId`, `hu`, `tu`, `hl`, `tl`, `A`, `B`, `C`, `sHome`, `sTravel` |
| `SETCAL` | The exact line that will be sent. **Send SETCAL** loads that relation into the Nano. `MOVE_UPPERMM`, `MOVE_LOWERMM`, and `MOVEBOTHMM` use it when `cal=1`. |
| Carriage in centring | Class B only. `MOVEAMMT2` to each shrink tube’s `centering_output_mm`, inside the centring step, after `h_pre_mm` and before `h_post_mm`. The table lists `L_eff`, axis, `h_pre_mm`, `h_post_mm`, and the output position. Carriage travel does not use the quadratic. |
| Backup | **Download slaveCal** writes a JSON file. **Restore backup** validates it, saves it, and sends `SETCAL`. |

---

## API

All routes require a signed-in **BYPASS** user. Other roles get 403. Success and failure use the project envelope (`status`, `data`, `error`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/centring/v2/height-calibration` | Saved pulses, current curve, and the step lists |
| POST | `/api/centring/v2/height-calibration/pulse-ends/drive` | Body `{ "axis": "upper" \| "lower", "position": "home" \| "travel" }`. One `CALDRV`. Does not save. |
| POST | `/api/centring/v2/height-calibration/pulse-ends/read` | Same body. Re-reads the live pulse while that switch is pressed. Does not move and does not save. |
| POST | `/api/centring/v2/height-calibration/pulse-ends/run` | Legacy four-step cycle. The Pulse ends page does not call it. |
| POST | `/api/centring/v2/height-calibration/pulse-ends/apply` | Validate and store `{ hu, tu, hl, tl }` |
| POST | `/api/centring/v2/height-calibration/curve/pose` | Body `{ "pose": "home" \| "travel" \| "mid" }`. Moves the jaws. |
| POST | `/api/centring/v2/height-calibration/curve/build` | Fit or place a curve from samples. Does not save. |
| POST | `/api/centring/v2/height-calibration/curve/apply` | Store and `SETCAL` the curve. Requires pulse ends. |
| POST | `/api/centring/v2/height-calibration/setcal` | Send the stored `slaveCal` with `SETCAL` |
| POST | `/api/centring/v2/height-calibration/backup/restore` | Validate a backup, save it, and `SETCAL` |
| GET | `/api/centring/v2/height-calibration/manual` | Live STATUS snapshot for switch lamps and jog gates (no motion) |
| POST | `/api/centring/v2/height-calibration/manual/nudge` | Body `{ "mode": "relative", "axis", "direction", "stepUs": 4 \| 10 \| 20 \| 50 \| 100 }` or `{ "mode": "absolute", "axis": "upper" \| "lower", "pulseUs": 250…2400 }`. One `NUDGE`; does not stop on switches |

Every apply is logged with the actor, the previous coefficients or pulses, and the applied values.

---

## Dependencies

- Centring Nano at `192.168.10.55:8177`, with firmware that implements `CALDRV` and STATUS `pu` / `pl`
- Host session in `centring_master.js` (`SETCAL`, `MOVEBOTHMM`, TCP queue)
- Saved `slaveCal` on the host (SQLite-backed centring config)
- Bypass account on the HMI
- A tape or gauge for the three opening measurements. The machine does not measure millimetres by itself

---

## Usage

1. Sign in as Bypass.
2. Open **Settings → Advanced → Height calibration**.
3. On **Pulse ends**, drive the upper jaw to open, save `hu`, drive it to closed, save `tu`. Repeat for the lower jaw (`hl`, then `tl`). Apply the four pulses. See [PULSE_ENDS_CALIBRATION_UX.md](./PULSE_ENDS_CALIBRATION_UX.md).
4. Open **Quadratic curve**. Drive HOME, type the measured total opening, add the sample. Repeat for TRAVEL. Drive Middle 1 through Middle 4, each at the height shown on its button, and add each sample. Those four openings replace `A`, `B`, and `C`.
5. Build the curve. Check the plot and the HOME and TRAVEL heights. Apply.
6. Power-cycle the Nano only as a check: initialization must restore the same relation with `SETCAL` and STATUS must show `cal=1`.

Drive and Save on Pulse ends are refused while a production cycle or machine initialization is moving the jaws.

---

## Limitations

- The Nano firmware image must be uploaded before `CALDRV` exists. Until then the pulse cycle fails with a rejected command. The image fills the Nano flash (30720 bytes). The old alias `CALIBRATION` was removed so `CALDRV` would fit. `CALIBRATE` remains.
- STATUS `pu` and `pl` are the commanded pulse. They are not a measured jaw position. After the servo signal drops, a pushed jaw still reports the old pulse.
- Two curve samples do not create a free quadratic. They keep `C` and move the curve onto the measured ends. The two ends plus four middle samples replace `A`, `B`, and `C`.
- Each middle pose is a switch fraction of the curve already loaded (20%, 40%, 60%, 80%). The sample angle is the angle STATUS reports after the move. Manual move uses `NUDGE` for posing; `MOVE*MM` still cannot command an opening the saved curve cannot solve.
- A host that accepts `C ≤ 0` still cannot apply that curve until the Nano image with the same check is uploaded. An older image rejects `SETCAL` with `reason=range` when `C ≤ 0`.
- `SETCAL` stores the relation and does not move the jaws. After Pulse ends, the jaws stay on the last position that was driven. Apply does not return them to HOME.
- This document does not change production `HOME` or `SEEK_TRAVEL`.

---

## Future improvements

- After Apply, offer a confirmed drive of both jaws back to HOME so the machine is left open.
- A raw pulse field that is never rewritten by the Version 1 switch resync, so a re-measure with `cal=1` cannot snap to the previous ends.
- Persist the gauge samples (who measured, total millimetres, pose) next to `slaveCal`, not only the fitted coefficients.
- Block the quadratic-curve drives while a production job is in progress. Pulse ends Drive and Save already refuse.
