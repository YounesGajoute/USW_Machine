# Pulse ends — operator experience

Status: **the Pulse ends page follows this procedure.** Quadratic curve and slaveCal stay on the same Settings section and are not this procedure.

This document is the user experience for measuring the four servo pulses. The host and Nano contract around those pulses is [VERSION_2_HEIGHT_CALIBRATION.md](./VERSION_2_HEIGHT_CALIBRATION.md). The drive command is `CALDRV` in [VERSION_2_NANO_FIRMWARE.md](./VERSION_2_NANO_FIRMWARE.md).

---

## Purpose

Pulse ends tell the centring system which commanded pulse width (µs) belongs to each jaw at its open switch and at its closed switch.

The Bypass user **jogs one jaw** toward HOME or TRAVEL with **Toward open** and **Toward closed** until the target switch is on, checks the position, and saves that pulse. Each jog is one `CALSTEP` (4 µs). The page does not run Upper and Lower, or open and closed, as a single automatic cycle. A failed jog does not discard a pulse the user has already saved.

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
  → Select one row, jog one jaw (CALSTEP) until the switch is on
  → Save that field (STATUS re-read while the switch is pressed)
  → Repeat for the other three positions
  → Apply four pulses (validate, save slaveCal, SETCAL)
```

| Layer | Role |
|-------|------|
| HMI | Upper and lower jaw stations. Each station has Open (HOME) and Closed (TRAVEL), the switch lamp, the pulse saved this visit, and the pulse stored on the machine. Closed is the left jog and Open is the right jog. Save sits under the jog buttons. Apply stays off until all four values are saved this visit and both spans are legal. |
| Step API | `POST /api/centring/v2/height-calibration/pulse-ends/step` sends one `CALSTEP` on one jaw. It does not store `slaveCal`. |
| Drive API | `POST /api/centring/v2/height-calibration/pulse-ends/drive` (legacy `CALDRV` seek) remains for tooling; the page uses Step. |
| Save API | `POST /api/centring/v2/height-calibration/pulse-ends/read` checks the switch and returns the live pulse. It does not move and does not store `slaveCal`. |
| Apply API | `POST /api/centring/v2/height-calibration/pulse-ends/apply` stores `{ hu, tu, hl, tl }` and sends `SETCAL`. The curve coefficients stay as they are. |

Only the role **BYPASS** can open the page and call these routes.

## Screen

The page is the **Pulse ends** tab.

- The range line shows `544–2400 µs`, open must exceed closed by at least `80 µs`, and each press is `4 µs`. Four marks (`hu`, `tu`, `hl`, `tl`) show which positions are saved this visit.
- The HMI is composed for a 16:9 Full HD stage, 1920×1080. **Lower** sits under **Upper**. Each jaw shows the commanded pulse. Each position shows the switch as **ON** or **OFF**, the pulse saved this visit, and the pulse already stored on the machine. The next unsaved position is labeled **Next**.
- The action column names the jaw that will move, for example **Upper · Open**. **Closed** (TRAVEL) is the left jog. **Open** (HOME) is the right jog. The jog that matches the selected position is the primary button. **Save** is a separate control under them, so it is not between the two motion buttons.
- A status line states the current step: what the switch and pulse are doing, and which control to press.
- **On the machine** repeats the four stored pulses. **Apply four pulses** is not on the working view. It appears only after `hu`, `tu`, `hl`, and `tl` are saved this visit. Confirmation lists those four pulses before the write.

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
   1. Select **Open · hu**. Press **Open** until HOME is on and the commanded pulse is shown.
   2. Press **Save hu**. The saved-this-visit value for `hu` updates.
   3. Select **Closed · tu**. Press **Closed** until TRAVEL is on.
   4. Press **Save tu**.
5. Repeat for the **Lower** jaw: **Open · hl**, then **Closed · tl**.
6. Press **Apply four pulses**. Confirm. The host stores the four values and sends `SETCAL`.

Drive order inside one jaw is open, then closed, so the closed pulse is measured by traveling off the open switch. The lower jaw can be measured before the upper jaw. Apply stays off until `hu`, `tu`, `hl`, and `tl` all have a saved-this-visit value, and until each open pulse is greater than its closed pulse by at least 80 µs. The host checks the same rules again.

Leaving the page or refreshing the browser clears the four saved-this-visit values. The pulses already stored on the host stay until a successful Apply.

---

## What each control does

### Jog (CALSTEP)

Each press moves the selected jaw one step (4 µs) toward HOME or TRAVEL. **Closed** is the left button and drives toward TRAVEL. **Open** is the right button and drives toward HOME. The page shows the commanded pulse and whether that position’s switch is ON or OFF. Nothing is stored until **Save**.

On failure the page says what happened, why, and how to recover:

| What happened | Why | Recovery |
|---------------|-----|----------|
| Production or initialization is running | Those sequences own the jaws | Wait until that sequence finishes, then drive again |
| The named switch is not pressed | Save was pressed before the switch was on | Jog until the switch is on, then save again |
| The pulse is outside 544–2400 µs | The commanded pulse is not a legal calibration end | Drive the same position again |
| The Nano does not answer | The centring link is down | Restore the link, then drive again |
| E-stop | The panel button is latched | Release the button, clear the E-stop, then drive again |

If the jaw is already on the named switch, Drive does not take another step. Save then keeps the pulse the Nano is already commanding. To measure a fresh edge, drive the same jaw to the other position first, then drive back.

The jaw that was not named stays at its current pulse. Both servo signals remain on during the drive.

### Save

Save is enabled only when the position is selected, its switch is on, and the commanded pulse is inside 544–2400 µs.

Save reads STATUS again. It stores the pulse in the page only when that same switch is still pressed. If the jaw has left the switch, Save fails and the previous saved-this-visit value for that field is left unchanged. Jog back onto the switch, then Save.

Save does not send `SETCAL` and does not change the stored `slaveCal`.

### Apply four pulses

Enabled only when `hu`, `tu`, `hl`, and `tl` are all saved this visit and both spans are legal (`hu > tu`, `hl > tl`, each pair at least 80 µs, every pulse inside 544–2400 µs). The page shows the failing span on the jaw and in the status line. The host repeats that check.

Apply checks the two spans, writes `slaveCal` on the host, and sends `SETCAL`. `A`, `B`, `C`, `sHome`, and `sTravel` stay as they were. `SETCAL` does not move the jaws. They remain at the last position that was driven.

After a successful Apply the saved-this-visit values clear, and the stored-on-the-host line shows the new pulses.

---

## Feedback

Every Drive, Save, and Apply shows one of:

- loading (`Moving…`, `Saving…`, `Applying…`, and the other controls locked while busy)
- success, naming the jaw, the position, the pulse in µs, and the field (`hu`, `tu`, `hl`, or `tl`) on the position card and in the status line
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
