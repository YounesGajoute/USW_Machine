# Per-side height model

**Project:** `/home/bot/Test_PlatformIO`  
**Source:** `src/main.cpp` (quadratic height block)  
**Must match:** master `centring_height_model.js`

---

## What “per-side height” means

Each jaw (upper / lower) maps its **signed angle** `s` (degrees) to a **height contribution in mm**. That contribution is the **per-side height**:

\[
h(s) = A + B\,s + C\,s^{2}
\]

The **total physical opening** is the sum of both sides plus an optional mechanical offset:

\[
h_{\text{physical}} = h(s_{\text{upper}}) + h(s_{\text{lower}}) + \text{mechOffset}
\]

Reported as `h=` in `STATUS`. Offset is set with `SETMECHOFF`.

---

## Constants

| Symbol | Value | Role |
|--------|------:|------|
| `A` | `7.054497` | Constant term (mm) |
| `B` | `-0.176873` | Linear term (mm/deg) |
| `C` | `0.00197035` | Quadratic term (mm/deg²) |
| `S_MIN` | `-80` | HOME switch angle (both axes) |
| `S_MAX` | `+35` | TRAVEL switch angle (both axes) |

Angle is always clamped to `[S_MIN, S_MAX]` before evaluating `h(s)`.

```c
static float hOf(float s) {
  s = clampf(s, S_MIN, S_MAX);
  return A + B * s + C * s * s;
}
```

---

## Shape of the curve

- At **HOME** (`s = -80`): per-side height is **maximum** → jaws more open.
- At **TRAVEL** (`s = +35`): per-side height is **minimum** → jaws more closed.
- `B < 0` and `C > 0` produce a gentle upward parabola; over the legal band, height falls as angle rises from HOME toward TRAVEL.

Approximate endpoints (model only, no offset):

| Angle `s` | \(h(s)\) (mm) |
|----------:|---------------:|
| `-80` (HOME) | ≈ `31.8` |
| `0` | ≈ `7.05` |
| `+35` (TRAVEL) | ≈ `3.28` |

Exact values come from `hOf()`; use those in code, not the table.

---

## Allowed total opening band

With both jaws at the same limit:

| State | Formula | Meaning |
|-------|---------|---------|
| Closed (min gap) | `gHMin = 2 · h(S_MAX) + mechOffset` | Both at TRAVEL |
| Open (max gap) | `gHMax = 2 · h(S_MIN) + mechOffset` | Both at HOME |

`MOVE*MM` rejects targets outside `[gHMin, gHMax]` with `h_out_of_range`.  
`SETMECHOFF` shifts the whole band without changing the quadratic shape.

---

## Inverse: mm → angle

Motion commands take a **total** height in mm and must recover a signed angle. After removing the offset:

\[
\text{modelH} = h_{\text{mm}} - \text{mechOffset}
\]

the firmware solves the quadratic for the needed **per-side** height \(h_p\):

\[
C\,s^{2} + B\,s + (A - h_p) = 0
\]

Roots:

\[
s = \frac{-B \pm \sqrt{B^{2} - 4C(A - h_p)}}{2C}
\]

Rules:

1. Discard roots outside `[S_MIN, S_MAX]` (small epsilon allowed).
2. If both roots are valid, pick the one **closest to the current angle** (shortest move).
3. If none are valid → `ERR … h_unreachable`.

### How each command chooses \(h_p\)

| Command | Per-side height \(h_p\) | Result |
|---------|-------------------------|--------|
| `MOVEBOTHMM` | `modelH / 2` | Both jaws → same target angle |
| `MOVE_UPPERMM` | `modelH − h(lower)` | Upper only; lower stays put |
| `MOVE_LOWERMM` | `modelH − h(upper)` | Lower only; upper stays put |

Single-axis moves fail if the other jaw already contributes more than `modelH` (`h_p < 0`).

---

## Example walk-through

Assume `mechOffset = 0`, `gU = gL = -80` (fully open at HOME).

1. Per-side at HOME: \(h(-80) ≈ 31.8\) mm each.  
2. Total: \(h_{\text{physical}} ≈ 63.6\) mm.  
3. Command: `MOVEBOTHMM 40 45`  
   - `modelH = 40`  
   - \(h_p = 20\) mm per side  
   - Solve \(h(s) = 20\) → target angle in `[-80, 35]` nearest current.  
4. Both jaws ramp to that angle; STATUS `h=` approaches 40 mm.

---

## Mental model

```
                    physical gap (mm)
           ┌─────────────────────────────────┐
           │  h(upper)  +  h(lower)  + offset │
           └─────────┬───────────┬───────────┘
                     │           │
              upper jaw     lower jaw
              h(s_u)        h(s_l)
                     │           │
                  angle °     angle °
```

- **Per-side height** = one jaw’s mm contribution from its angle.  
- **Physical height** = both jaws + optional `mechOffset`.  
- Forward: angle → mm (`hOf`). Inverse: mm → angle (`solveSignedFromHeight` / `mmToTargetDeg`).

---

## Related code

| Function | Role |
|----------|------|
| `hOf(s)` | Forward per-side height |
| `hPhysical()` | Total opening for STATUS |
| `initFixedHRange()` | Compute `gHMin` / `gHMax` |
| `heightInRange(h)` | Clamp check for MOVE commands |
| `solveSignedFromHeight(h_p, current, out)` | Inverse quadratic solve |
| `mmToTargetDeg(ac, hMm, out)` | Command-specific mm → target degrees |
