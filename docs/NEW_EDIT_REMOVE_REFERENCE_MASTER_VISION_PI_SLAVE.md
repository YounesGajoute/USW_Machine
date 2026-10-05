# New / Edit / Remove Reference (Master ↔ Vision Pi)

Short reference for all data involved when creating, editing, or deleting a product reference on the US Machine master HMI, including what is created or removed on the Vision Pi slave.

**UI:** References page  
**Master DB:** `product_references` (SQLite `maindata.db`)  
**Vision link:** `vision_program_id` → Vision Pi `/api/programs` (proxied as `/api/vision/programs`)

---

## Prerequisites

1. At least one **active** shrink tube profile (`Settings → Shrink Tubes`). Create is disabled until then.
2. Vision Pi reachable if vision inspection is enabled (`VISION_URL` + keys — see [VISION_MASTER_CONFIGURATION.md](./VISION_MASTER_CONFIGURATION.md)).
3. Optional: site-wide **general** tool template under `Settings → Vision` (`vision_general_tool_template`).
4. Vision Pi master-sync APIs (local key): `visionChecksConfig` / `shrinkTubeProfile` on program create/update, plus `/api/programs/:id/reference-template`.

---

## Shrink tube profile data

**UI:** Settings → Shrink Tubes  
**Master DB:** `shrink_tubes`  
**API:** `GET/POST /api/shrink-tubes`, `PATCH/DELETE /api/shrink-tubes/:id`  
**Link to reference:** `product_references.shrink_tube_id` → `shrink_tubes.id`

Used for centring geometry, production validation, **and** Vision heat-shrink Dimension `expectedMm`:

| Master field | Vision |
|--------------|--------|
| `length_mm` | `heat_shrink_length.expectedMm` |
| `diameter_mm` | `heat_shrink_diameter.expectedMm` |

Sent as `shrinkTubeProfile: { length_mm, diameter_mm }` on program create/update. Editing tube length/diameter **immediately re-syncs** linked active vision-enabled references (tube wins over prior operator overrides for those two fields).

### Operator fields (create / edit)

| Field | Required | Default | Notes |
|-------|----------|---------|--------|
| `name` | Yes | — | Unique (case-insensitive) |
| `diameter_mm` | Yes | — | Positive number (mm) |
| `length_mm` | Yes | — | Positive number (mm) |
| `diameter_closing_gap_mm` | No | `0` | ≥ 0 (mm) |
| `diameter_opening_gap_mm` | No | `0` | ≥ 0 (mm) |
| `centring_length_tolerance_mm` | No | `0` | ≥ 0 (mm) |
| `centring_mechanism` | No | `"upper"` | `"upper"` \| `"lower"` \| `"upper_and_lower"` |
| `is_active` | No | `true` | Inactive tubes cannot be newly assigned to a reference |

**Server-assigned on create:**

| Field | Value |
|-------|--------|
| `id` | `ST-` + last 6 digits of `Date.now()` |
| `is_active` | `1` |
| `created_at` / `updated_at` | ISO timestamps |

**Effective length check (UI):**  
`L_eff = length_mm + centring_length_tolerance_mm` must be within the centring frame (default **40–300 mm**).

### Derived geometry (computed, not operator-entered)

Written on create/update via `refreshShrinkTubeDerived` from tube fields + system `centring_frame_config`. Production requires a complete derived recipe (`has_derived_geometry`).

| Field | Meaning |
|-------|---------|
| `l_eff_mm` | Effective length (`length + tolerance`) |
| `h_pre_mm` / `h_post_mm` | Pre / post centring heights |
| `centering_travel_mm` | Centring travel |
| `centering_input_mm` / `centering_output_mm` | Input / output positions |
| `centering_move_travel_mm` | Move travel for centring axis |
| `centring_axis` | Axis used for the move |
| `centring_derived_updated_at` | When derived values were last refreshed |
| `has_derived_geometry` | API flag — all required derived values present |

### Reference link rules

- Every reference **must** store an active `shrink_tube_id` on create.
- Edit: may keep an already-assigned tube even if later deactivated; new assignment must be active.
- Delete shrink tube blocked with **400** if any reference still uses it.
- Production: loaded reference’s tube must be active and have complete derived geometry (unless `PRODUCTION_SKIP_CENTRING=1`).

---

## Create — operator fields

| Field | Required | Default | Notes |
|-------|----------|---------|--------|
| `name` | Yes | — | Uppercased barcode style; max 64 chars; pattern `A–Z 0–9 . _ -` only; unique (case-insensitive) |
| `description` | No | `""` | Free text |
| `shrink_tube_id` | Yes | — | Must be an **active** `shrink_tubes.id` (see above) |
| `vision_inspection_enabled` | No | `true` | If false, no Vision program is created |
| `send_barcode_weld_enabled` | No | `true` | Serial broadcast to welding machine on load |
| `send_barcode_shrink_enabled` | No | `true` | Serial broadcast to shrink machine on load |
| `tool_config_mode` | No | `"general"` | `"general"` \| `"specific"` |
| `vision_checks_config` | No | all checks off | When vision is enabled, **pushed to Vision** as inspection options |
| `specific_tools` / `specific_tool_template_id` | No | null | Used when mode is `specific` |

**Server-assigned on create:**

| Field | Value |
|-------|--------|
| `id` | `REF-` + last 6 digits of `Date.now()` |
| `is_active` | `1` |
| `vision_program_id` | `null` initially; then set after Vision program create |
| `created_at` / `updated_at` | ISO timestamps |

---

## Create — sequence

```
1. POST /api/references          → row in product_references (vision_program_id = null)
2. If vision_inspection_enabled:
   a. POST /api/vision/programs with name, camera/GPIO defaults,
      visionChecksConfig, shrinkTubeProfile, tools: [] (no classic Outline list)
   b. PATCH /api/references/:id  → store vision_program_id
   c. PUT program again with inspectionOptions.selected + shrinkTubeProfile
      (Vision builds option tools; auto-template waits for master image)
```

Helper: `frontend/src/lib/syncReferenceVisionInspection.ts`.

If the Vision Pi is offline at step 2, the master row still exists (**Vision sync pending**). Open **Settings → Vision** (or re-save / load the reference) when the slave is back.

### Vision Pi assets created

| Asset | When | Naming |
|-------|------|--------|
| Inspection **program** | Vision enabled | Same as reference `name` |
| `inspectionOptions.selected` + option tools | From `vision_checks_config` | See mapping below |
| Heat-shrink `expectedMm` | From linked shrink tube | length / diameter |
| Reference template | After master image register **and/or** Tool configuration Apply | Auto on Vision (no HMI template UI) |

Program create also seeds default camera/GPIO config (gain, exposure, trigger, OUT1–OUT8) via the HMI proxy.

---

## `vision_checks_config` shape

Stored as `vision_checks_json` on the master. Defaults are all `false`. **Pushed to Vision** as `visionChecksConfig` → `inspectionOptions.selected` + option tools (not master-only gating).

```json
{
  "welding_splice": {
    "enabled": false,
    "length_check": false,
    "width_check": false,
    "position_check": false
  },
  "heat_shrink_tube": {
    "enabled": false,
    "length_check": false,
    "diameter_check": false,
    "position_check": false
  }
}
```

| Master flag | Vision `optionId` |
|-------------|-------------------|
| `welding_splice.enabled` + `length_check` | `welding_splice_length` |
| `welding_splice.enabled` + `width_check` | `welding_splice_width` |
| `welding_splice.enabled` + `position_check` | `welding_splice_position` |
| `heat_shrink_tube.enabled` + `length_check` | `heat_shrink_length` |
| `heat_shrink_tube.enabled` + `diameter_check` | `heat_shrink_diameter` |
| `heat_shrink_tube.enabled` + `position_check` | `heat_shrink_position` |

Turning vision inspection **off** clears checks back to the default on the master.

---

## Edit

`PATCH /api/references/:id` — same fields as create, plus `is_active`.

- Name uniqueness still enforced (excluding self).
- Shrink tube required; reassignment must be an **active** tube (keeping the already-assigned tube is allowed even if later deactivated).
- If vision is (or becomes) enabled and `vision_program_id` is missing, the HMI runs the same ensure/create + inspection sync as on create.
- On changes to `vision_checks_config`, `shrink_tube_id`, or name → **PUSH** `PUT /api/vision/programs/:id` with updated checks + `shrinkTubeProfile` (option tools only).

---

## Remove

`DELETE /api/references/:id`

1. If `vision_program_id` is set, master deletes on the Vision Pi (via local key proxy):
   - optional leftover tool template(s) matching the reference name and/or `specific_tool_template_id`
   - the vision **program** (master image + reference template artifacts removed with it on Vision)
2. Deletes the `product_references` row.

Master delete still succeeds if Vision cleanup warns/fails; response includes `vision: { programId, programDeleted, templatesDeleted, warnings }`.

---

## Settings → Vision

Bound to the **loaded** reference’s `vision_program_id`.

| Tab | Role |
|-----|------|
| Master image | Capture / register (Vision rebuilds reference template from image) |
| **Tool configuration** | Enabled inspection checks only (Dimension / Position). Dimension UX: Expected + Tolerance ± (Min/Max = Expected±Tolerance; P1/P2 by image tap only). Position UX: safe/warning zones + center by image tap only. Apply → PUT program; Vision auto-updates reference template. **No** classic Outline/Area picker. **No** template sub-tab or Rebuild button. |
| General template | Optional site defaults (not per-program classic tools) |

If Vision is on but no inspection checks remain enabled, Vision inspection is **auto-disabled** on the reference (no “enable checks” empty state). Tool configuration then shows: “Vision inspection is disabled for this reference.”  
Offline Vision: master reference save still works; UI shows **Vision sync pending**.

---

## Master ↔ Vision data map

| Master (`product_references` / `shrink_tubes`) | Vision Pi |
|-----------------------------------------------|-----------|
| `name` | Program name |
| `vision_program_id` | Program numeric id |
| `vision_checks_config` | `inspectionOptions.selected` + option tools |
| `shrink_tubes.length_mm` | `heat_shrink_length` `expectedMm` |
| `shrink_tubes.diameter_mm` | `heat_shrink_diameter` `expectedMm` |
| Tool configuration Apply | `PUT` program `inspectionOptions.params` (+ ROIs); Vision auto-template |
| Master image Register | `POST /api/master-image` → Vision rebuilds template |

Auth reminder: program CRUD uses **local** key (`VISION_LOCAL_KEY` → `X-Vision-Local-Key` on `/api/vision/programs`). Inspection/capture uses **remote** key. See [VISION_MASTER_CONFIGURATION.md](./VISION_MASTER_CONFIGURATION.md).

---

## Related code

| Area | Location |
|------|----------|
| Create/edit UI flow | `frontend/src/pages/ReferencesPage.tsx` |
| Form validation / payload | `frontend/src/lib/referenceForm.ts` |
| Inspection sync helper | `frontend/src/lib/syncReferenceVisionInspection.ts` |
| Option id mapping | `frontend/src/lib/visionInspectionOptions.ts` |
| Shrink tube types / L_eff validation | `frontend/src/types/shrinkTube.types.ts` |
| Shrink tubes settings UI | `frontend/src/components/settings/sections/ShrinkTubesSection.tsx` |
| Vision program ensure | `frontend/src/lib/referenceVisionProgram.ts` |
| Tool configuration (inspection checks) | `frontend/src/components/settings/vision/ToolConfigurationTab.tsx` |
| REST CRUD + vision proxies | `backend/index.mjs` |
| Production tube / centring context | `backend/lib/productionContext.mjs` |
| Vision delete on remove | `backend/lib/referenceVisionCleanup.mjs` |
