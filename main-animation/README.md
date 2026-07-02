# Wire Splice Vision Check Animation — Main Project Integration

Drop-in package to add the animated vision-check diagram to the **USW_Machine** app and
rename the welding-splice **Diameter** check to **Width**.

The folders below mirror the main project layout
(`USW_Machine-main/`), so you can copy the `frontend/` and `backend/` trees straight over.

```
main-project-integration/
  frontend/src/components/reference/
    WireSpliceVisionAnimation.tsx   (NEW)  animated SVG diagram
    HeatShrinkLayoutControls.tsx    (NEW)  position-tuning sliders
    VisionChecksFields.tsx          (REPLACE) now renders the animation + legend
  frontend/src/lib/
    visionChecksConfig.ts           (REPLACE) adds VISION_CHECK_SPECS, width migration
  frontend/src/types/
    reference.types.ts              (EDIT)  welding diameter_check -> width_check, + VisionCheckId
  backend/lib/
    visionChecksConfigStore.mjs     (REPLACE) width_check + "Welding Splice Width Check"
    visionChecksConfigStore.test.mjs (REPLACE) updated assertions
```

> **Scope of the rename:** only the **welding splice** check changes from *diameter* to
> *width*. The **heat-shrink tube** keeps `diameter_check` (a tube is genuinely cylindrical,
> so "diameter" is correct there).

---

## Prerequisites (already present in the main project)

The components reuse existing building blocks — no changes needed:

- `@/components/ui/Switch`
- `@/contexts/ThemeContext` (`useTheme().colors`)
- `@/types/reference.types`, `@/lib/visionChecksConfig`

No new npm dependencies. The caliper image was removed, so **no SVG asset is required**.

---

## Frontend steps

1. **Copy the two new components** into `frontend/src/components/reference/`:
   - `WireSpliceVisionAnimation.tsx`
   - `HeatShrinkLayoutControls.tsx`

2. **Replace** `frontend/src/components/reference/VisionChecksFields.tsx` with the one here.
   It renders the animation + a colour legend above the existing toggles, and shows the
   heat-shrink position-tuning sliders when the position check is on. Props are unchanged
   (`value`, `onChange`, `disabled`), so `ReferenceOptionsFields.tsx` needs no edits.

3. **Replace** `frontend/src/lib/visionChecksConfig.ts` with the one here. It adds:
   - `VISION_CHECK_SPECS` — labels + descriptions per check
   - `defaultChecksOnGroupEnable()`
   - `getEnabledVisionCheckIds()`
   - legacy migration: an old stored `welding_splice.diameter_check` is read as `width_check`.

4. **Edit** `frontend/src/types/reference.types.ts`:
   - In `VisionChecksConfig.welding_splice`, rename `diameter_check` → `width_check`
     (leave `heat_shrink_tube.diameter_check` as-is).
   - Add the `VisionCheckId` union type.

   A ready-made copy is included here. If your `reference.types.ts` has drifted, apply just
   those two changes by hand instead of overwriting (the file holds many other types).

---

## Backend steps

1. **Replace** `backend/lib/visionChecksConfigStore.mjs` with the one here. Changes:
   - `welding_splice.diameter_check` → `width_check`
   - tool name `'Welding Splice Diameter Check'` → `'Welding Splice Width Check'`
   - `getEnabledWeldingSpliceToolNames()` now emits the width tool
   - `normalizeVisionChecksConfig()` / `mergeVisionChecksConfigPatch()` migrate legacy
     `diameter_check` so previously stored references keep working.

2. **Replace** `backend/lib/visionChecksConfigStore.test.mjs` with the one here.

3. **Edit** `backend/lib/productionVisionSequence.test.mjs` — rename `diameter_check` to
   `width_check` **only inside `welding_splice` blocks** (lines ~48, ~62, ~69, ~80).
   Leave every `heat_shrink_tube` `diameter_check` untouched (lines ~57, ~63, ~75, ~236).
   These tests pass even without editing thanks to the migration, but renaming keeps them clear.

Run the backend tests:

```bash
cd backend
node --test lib/visionChecksConfigStore.test.mjs
node --test lib/productionVisionSequence.test.mjs
```

---

## Vision Pi dependency (action required on the machine)

The backend now sends the tool name **"Welding Splice Width Check"** to the vision slave.
The matching tool in each Vision Pi inspection program **must be renamed to the same string**,
otherwise the production handoff reports a missing tool. The other tool names are unchanged.

---

## What the animation shows

Driven entirely by the saved `vision_checks_config` — no extra props:

| Check | Visual |
|---|---|
| Welding splice **length** | Horizontal dimension arrows above the weld (blue) + MASTER outline |
| Welding splice **width** | Copper zone highlighted with **WIDTH FAULT** badge + vertical dimension arrows (orange) |
| Welding splice **position** | Centre crosshairs over the weld (green) |
| Heat-shrink **position** | Tube slides from the warning zone into the safe zone (animated) |
| Heat-shrink **length** | Horizontal dimension arrows across the tube top (light blue) |
| Heat-shrink **diameter** | Vertical dimension arrows along the tube right edge (light orange) |

Dimension arrows use a shared `vc-arrow` marker with `orient="auto-start-reverse"`, so the two
arrowheads on each line point outward, opposing each other.

---

## Verifying locally before integrating

The standalone preview lives in this workspace's `animation-test/`:

```bash
cd animation-test
npm install
npm run dev
```

Cycle through the presets (welding width, heat-shrink length/diameter, etc.) to confirm the
visuals, then copy the files into the main project.
