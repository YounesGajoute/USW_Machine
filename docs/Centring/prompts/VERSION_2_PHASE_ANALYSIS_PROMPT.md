# Agent prompt — Version 2 centring phase analysis (superseded)

**Status: superseded. Do not run this prompt.**

The earlier version of this prompt asked an agent to mine the Version 1 production phases (`centring_h_pre`, `centring_h_post`, `move_centering_travel`, `centring_restore_*`, …) and freeze them as Version 2 requirements, including `L_eff < 55` hold `h_pre`, carriage travel, `h_post`, and classic versus advanced restore. That direction is withdrawn.

The canonical Version 2 contract is:

- [VERSION_2_PHASE_REQUIREMENTS.md](../VERSION_2_PHASE_REQUIREMENTS.md)

Key points a later agent must follow:

- Production length classes from the loaded reference: **`40 ≤ L_eff ≤ 55 mm`** and **`55 < L_eff ≤ 100 mm`**; the cycles differ.
- Rest states per axis: HOME, TRAVEL (switches), h_pre, h_post (servo angle / pulse width compared with the expected angle).
- No command is blocked by the Nano or the host session because a switch is pressed.
- **Rebuilt:** simple drive to HOME and to TRAVEL (replacing `HOME` and `SEEK_TRAVEL`); rest state; production orchestration; removal of the switch gates.
- **Reused:** Version 1 height move (`MOVE_*MM`), height model, saved calibration values, recipe (`centringDerivedRecipe.mjs`, `centring_frame_model.js`), total-opening height, `centring_axis`, TCP link and host session code.
- Initialization: HOME on both axes, apply saved calibration if `cal=0`, then height move to `h_pre_mm`.
- Do not derive Version 2 phases or orchestration from Version 1 production code.

Section 11 of the requirements is decided, including the Class A UNKNOWN recovery to `h_pre_mm` and the Class B centring step. Do not reopen those decisions from this prompt.

---

*Superseded 2026-10-05.*
