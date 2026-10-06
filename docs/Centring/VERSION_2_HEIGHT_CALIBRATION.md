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

The US Machine HMI is where a Bypass user measures a new set of pulse ends and, separately, a new quadratic millimetre curve.

---

## Architecture

The host stores the relation. The Nano keeps a copy in RAM and loses it at every power loss. After power loss, initialization sends the stored copy with `SETCAL` once the jaws are at HOME.

```text
Bypass user
  → Settings → Height calibration
  → Pulse ends page  or  Quadratic curve page
  → POST /api/centring/v2/height-calibration/...
  → host checks the numbers, saves slaveCal, SETCAL to the Nano
```

| Layer | Role |
|-------|------|
| HMI | Two pages. Confirmation before motion. Loading, success, and failure. |
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
| `A`, `B`, `C` | 4.67687625, −0.176873, 0.00197035 | Curve coefficients. `C` must be greater than 0 |
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

`SETCAL` stores `A`, `B`, `C`, `sHome`, and `sTravel` with the four pulses. The Nano rejects the line unless `sTravel > sHome`, `C > 0`, and the HOME height is greater than the TRAVEL height.

---

## Pulse-end cycle

Page: **Pulse ends**.

The HMI asks for confirmation. The jaws then move. Upper is finished before lower starts.

| Step | Command | Recorded when | Saved as |
|------|---------|---------------|----------|
| 1 | `CALDRV OPEN U` | Upper HOME switch is pressed | `hu` |
| 2 | `CALDRV CLOSE U` | Upper TRAVEL switch is pressed | `tu` |
| 3 | `CALDRV OPEN L` | Lower HOME switch is pressed | `hl` |
| 4 | `CALDRV CLOSE L` | Lower TRAVEL switch is pressed | `tl` |

`CALDRV` steps the pulse 4 µs every 20 ms.

- `OPEN` increases the pulse and stops on the HOME switch.
- `CLOSE` decreases the pulse and stops on the TRAVEL switch.
- If that switch is already pressed, the drive does not take another step.
- The other switch does not stop the drive.
- The pulse is not rewritten from the switch bits for this drive.
- If the pulse reaches 544 or 2400 µs without the switch, or 60 seconds pass, the step ends as a timeout and nothing is saved.

The live pulse is STATUS `pu` (upper) and `pl` (lower). After the four steps the page shows the measured microseconds. **Apply measured ends** validates them, keeps the current curve coefficients, saves `slaveCal` on the host, and sends `SETCAL`.

Applying pulse ends does not by itself change `A`, `B`, `C`, `sHome`, or `sTravel`.

---

## Quadratic-curve cycle

Page: **Quadratic curve**.

The page plots the current curve from `sHome` to `sTravel` and shows `A`, `B`, `C`, the angle labels, and the per-jaw heights at the two ends.

Creating a new curve needs the jaws at known poses and a measured **total** opening typed in millimetres. The per-jaw sample is half of that total.

| Step | Drive | Sample angle | What you type |
|------|-------|--------------|---------------|
| 1 | `CALDRV OPEN BOTH` | `sHome` (−80° unless a saved curve says otherwise) | Total opening at HOME, mm |
| 2 | `CALDRV CLOSE BOTH` | `sTravel` (+35° unless a saved curve says otherwise) | Total opening at TRAVEL, mm |
| 3 | `MOVEBOTHMM` to the mid opening of the **current** curve | Halfway between `sHome` and `sTravel` | Total opening at that pose, mm |

Then **Build curve**:

- **Three samples.** A new `A`, `B`, and `C` are fitted. `C` must come out greater than 0, and the HOME height must be greater than the TRAVEL height.
- **Two samples** (HOME and TRAVEL only). The curve is placed on those two measured per-jaw heights and the existing curvature `C` is kept. `sHome` and `sTravel` stay as they are.

**Apply curve** is refused until pulse ends have already been saved. It writes `A`, `B`, `C`, `sHome`, and `sTravel` into the same `slaveCal` record and sends `SETCAL`. The four pulses are left as last applied.

The mid move uses the curve that is already on the Nano, only to place the jaws. The number you type is the measurement. It replaces that curve when you apply.

---

## slaveCal, SETCAL, carriage, and backup

The third HMI page, **slaveCal**, is the record the height moves use.

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
| POST | `/api/centring/v2/height-calibration/pulse-ends/run` | Run the four-step pulse cycle. Does not save. |
| POST | `/api/centring/v2/height-calibration/pulse-ends/apply` | Validate and store `{ hu, tu, hl, tl }` |
| POST | `/api/centring/v2/height-calibration/curve/pose` | Body `{ "pose": "home" \| "travel" \| "mid" }`. Moves the jaws. |
| POST | `/api/centring/v2/height-calibration/curve/build` | Fit or place a curve from samples. Does not save. |
| POST | `/api/centring/v2/height-calibration/curve/apply` | Store and `SETCAL` the curve. Requires pulse ends. |
| POST | `/api/centring/v2/height-calibration/setcal` | Send the stored `slaveCal` with `SETCAL` |
| POST | `/api/centring/v2/height-calibration/backup/restore` | Validate a backup, save it, and `SETCAL` |

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
2. Open **Settings → Height calibration**.
3. Run **Pulse ends**. Confirm the motion. Check the four microseconds. Apply.
4. Open **Quadratic curve**. Drive HOME, type the measured total opening, add the sample. Repeat for TRAVEL. Repeat for mid if a new `A`, `B`, `C` is required.
5. Build the curve. Check the plot and the HOME and TRAVEL heights. Apply.
6. Power-cycle the Nano only as a check: initialization must restore the same relation with `SETCAL` and STATUS must show `cal=1`.

Do not run the pulse cycle while a production job is moving the jaws.

---

## Limitations

- The Nano firmware image must be uploaded before `CALDRV` exists. Until then the pulse cycle fails with a rejected command. The image fills the Nano flash (30720 bytes). The old alias `CALIBRATION` was removed so `CALDRV` would fit. `CALIBRATE` remains.
- STATUS `pu` and `pl` are the commanded pulse. They are not a measured jaw position. After the servo signal drops, a pushed jaw still reports the old pulse.
- Two curve samples do not create a free quadratic. They keep `C` and move the curve onto the measured ends. Three samples are required to replace `A`, `B`, and `C`.
- The mid pose is reached with the curve already loaded. There is no independent pulse-jog command.
- `SETCAL` writes both live pulses to the calibrated HOME pulses. Apply it when the jaws are on the HOME switches, which is how the pulse cycle ends (lower axis has just been driven closed, so the host should return both jaws to HOME before a later `SETCAL` if the jaws must match those pulses). The pulse-end apply sends `SETCAL` immediately after the lower TRAVEL measurement. The jaws are then at TRAVEL while the Nano writes the HOME pulses. Treat that apply as storing the numbers; run `CALDRV OPEN BOTH` afterwards if the jaws must sit on the open switches before production.
- This document does not change production `HOME` or `SEEK_TRAVEL`.

---

## Future improvements

- After applying pulse ends, drive both jaws back to HOME before `SETCAL` so the written HOME pulses match the mechanics.
- A raw pulse field that is never rewritten by the Version 1 switch resync, so a re-measure with `cal=1` cannot snap to the previous ends.
- Persist the gauge samples (who measured, total millimetres, pose) next to `slaveCal`, not only the fitted coefficients.
- Block the calibration pages while a production job is in progress.
