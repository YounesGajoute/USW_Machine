# Pulse ends — operator experience

Status: **the Pulse ends page follows this procedure.** Quadratic curve and slaveCal stay on the same Settings section and are not this procedure.

This document is the user experience for measuring the four servo pulses. The host and Nano contract around those pulses is [VERSION_2_HEIGHT_CALIBRATION.md](./VERSION_2_HEIGHT_CALIBRATION.md). The drive command is `CALDRV` in [VERSION_2_NANO_FIRMWARE.md](./VERSION_2_NANO_FIRMWARE.md).

---

## Purpose

Pulse ends tell the centring system which commanded pulse width (µs) belongs to each jaw at its open switch and at its closed switch.

The Bypass user drives **one jaw** to **one switch**, checks that the jaw is there, and saves that pulse. The page does not run Upper and Lower, or open and closed, as a single automatic cycle. A failed drive does not discard a pulse the user has already saved.

| Jaw | Position the user drives to | Switch that must be pressed | Value saved |
|-----|-----------------------------|-----------------------------|-------------|
| Upper | Open | HOME | `hu` |
| Upper | Closed | TRAVEL | `tu` |
| Lower | Open | HOME | `hl` |
| Lower | Closed | TRAVEL | `tl` |

`hu` must be greater than `tu`. `hl` must be greater than `tl`. Each pair needs at least 80 µs of span. Every pulse must be from 544 to 2400 µs.

---

## Architecture

```text
Bypass user
  → Settings → Advanced → Height calibration → Pulse ends
  → Drive one jaw to one position (confirmation, then CALDRV)
  → Save that field (STATUS re-read while the switch is pressed)
  → Repeat for the other three positions
  → Apply four pulses (validate, save slaveCal, SETCAL)
```

| Layer | Role |
|-------|------|
| HMI | Four position rows. Drive and Save on each row. Apply only when all four values are saved this visit. |
| Drive API | `POST /api/centring/v2/height-calibration/pulse-ends/drive` moves one jaw. It does not store `slaveCal`. |
| Save API | `POST /api/centring/v2/height-calibration/pulse-ends/read` checks the switch and returns the live pulse. It does not move and does not store `slaveCal`. |
| Apply API | `POST /api/centring/v2/height-calibration/pulse-ends/apply` stores `{ hu, tu, hl, tl }` and sends `SETCAL`. The curve coefficients stay as they are. |

Only the role **BYPASS** can open the page and call these routes.

---

## Dependencies

- Signed-in Bypass user
- Centring Nano at `192.168.10.55:8177` with `CALDRV` and STATUS `pu` / `pl`
- No production cycle and no machine initialization in progress. Both block Drive and Save
- The jaw path clear to the switch being measured

---

## Usage

1. Sign in as Bypass.
2. Open **Settings → Advanced → Height calibration**.
3. Stay on **Pulse ends**.
4. For the **Upper** jaw:
   1. Press **Drive Upper to open (HOME)**. Confirm. Wait until the row shows the pulse in µs and the success line says the jaw is at the open position.
   2. Press **Save hu**. The saved-this-visit value for `hu` updates.
   3. Press **Drive Upper to closed (TRAVEL)**. Confirm. Wait for the pulse.
   4. Press **Save tu**.
5. Repeat for the **Lower** jaw: drive open, save `hl`, drive closed, save `tl`.
6. Press **Apply four pulses**. Confirm. The host stores the four values and sends `SETCAL`.

Drive order inside one jaw is open, then closed, so the closed pulse is measured by traveling off the open switch. The lower jaw can be measured before the upper jaw. Apply is refused until `hu`, `tu`, `hl`, and `tl` all have a saved-this-visit value.

Leaving the page or refreshing the browser clears the four saved-this-visit values. The pulses already stored on the host stay until a successful Apply.

---

## What each control does

### Drive

Asks for confirmation because the jaw moves.

On success the page shows the commanded pulse and which position the jaw reached. That pulse is not stored yet.

On failure the page says what happened, why, and how to recover:

| What happened | Why | Recovery |
|---------------|-----|----------|
| Production or initialization is running | Those sequences own the jaws | Wait until that sequence finishes, then drive again |
| The named switch is not pressed | The drive ended before the jaw reached that switch | Clear the path and drive the same position again |
| The pulse is outside 544–2400 µs | The commanded pulse is not a legal calibration end | Drive the same position again |
| The Nano does not answer | The centring link is down | Restore the link, then drive again |
| E-stop | The panel button is latched | Release the button, clear the E-stop, then drive again |

If the jaw is already on the named switch, Drive does not take another step. Save then keeps the pulse the Nano is already commanding. To measure a fresh edge, drive the same jaw to the other position first, then drive back.

The jaw that was not named stays at its current pulse. Both servo signals remain on during the drive.

### Save

Save is enabled only for the position that was just driven successfully.

Save reads STATUS again. It stores the pulse in the page only when that same switch is still pressed. If the jaw has left the switch, Save fails and the previous saved-this-visit value for that field is left unchanged. Drive that position again, then Save.

Save does not send `SETCAL` and does not change the stored `slaveCal`.

### Apply four pulses

Enabled only when `hu`, `tu`, `hl`, and `tl` are all saved this visit.

Apply checks the two spans, writes `slaveCal` on the host, and sends `SETCAL`. `A`, `B`, `C`, `sHome`, and `sTravel` stay as they were. `SETCAL` does not move the jaws. They remain at the last position that was driven.

After a successful Apply the saved-this-visit values clear, and the stored-on-the-host line shows the new pulses.

---

## Feedback

Every Drive, Save, and Apply shows one of:

- loading (`Driving…`, `Applying…`, or the button disabled while busy)
- success, naming the jaw, the position, the pulse in µs, and the field (`hu`, `tu`, `hl`, or `tl`)
- failure, with what happened, why, and the recovery

Units are microseconds. The allowed range is shown on the page.

---

## Limitations

- The four saved-this-visit pulses live in the browser until Apply. A refresh before Apply drops them.
- A jaw already sitting on the switch is not backed off and re-sought. The saved pulse is the commanded pulse, which is wrong if the jaw was pushed onto the switch while the servo signal was off.
- The firmware switch drive can continue to 250 µs when a TRAVEL switch never closes. Save still rejects any pulse below 544 µs, so that reading is not stored. The jaw may already have been driven there.
- There is no Cancel after the drive has been confirmed. Stop the motion with the panel E-stop.
- `POST /api/centring/v2/height-calibration/pulse-ends/run` still runs all four drives in one request. The Pulse ends page does not call it.

---

## Future improvements

- Keep the four saved-this-visit pulses on the host so a refresh does not drop them before Apply.
- Back the jaw off a switch that is already pressed, then drive onto it again, so Save cannot record a stale pulse.
- Stop a TRAVEL drive at 544 µs instead of 250 µs when the switch does not close.
- Add a page-level stop that sends `KILL` without using the panel E-stop.
