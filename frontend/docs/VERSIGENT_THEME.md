# Versigent UI Theme

## Theme modes (Settings → General → Theme)

| Mode | Storage id | Source |
|------|------------|--------|
| Light | `light` | Frozen copy from git (`legacyThemePalettes.ts`) — **unchanged** |
| Dark | `dark` | Frozen copy from git — **unchanged** |
| Versigent | `versigent` | Official brand palette (PPTX `theme3.xml`) |

Legacy themes restore original files from git where it matters:
- `legacyThemePalettes.ts` — exact palette hex values
- `Header.tsx` — cyan bar + original nav styling (Versigent only changes header when `versigent` is active)
- `App.css`, `index.css`, `tailwind.config.ts`, `Button.tsx`, `defaultVisionTools.ts`

Older stored values `versigent-light` and `versigent-dark` are migrated to `versigent` on read.

## Versigent official palette (`Versigent_Color_Palette_Official`)

Extracted from `Centering system USW.pptx` → `ppt/theme/theme3.xml`.

| Token | Hex | UI role |
|-------|-----|---------|
| dk1 | `#FFFFFF` | Text on dark surfaces |
| lt1 | `#000000` | Text on light surfaces |
| dk2 | `#CD7925` | Copper — logo, secondary buttons, decorative lines |
| lt2 | `#16283F` | Navy — headings, header, body text |
| accent1 | `#0857C3` | Primary actions, buttons, focus rings |
| accent2 | `#74D2E7` | Highlights, info, nav glow |
| accent3 | `#004624` | Success / operational OK |
| accent4 | `#79DD05` | Data series, positive highlight |
| accent5 | `#F7A900` | Warning, hyperlinks |
| accent6 | `#FBFAF6` | Page background (cream) |
| hlink | `#F7A900` | Active links |
| folHlink | `#CB9552` | Visited links, warm bronze |

**Derived (masters / UI):** `navy-deep` `#112233`, `muted` `#929D96`, `muted-dark` `#878F84`, `border-warm` `#E5E1DA`, `wordmark-dark` `#030303`.

**Data / chart series order:** accent1 → accent6 (blue, cyan, green, bright green, gold, cream).

Typography: **Akkurat Pro**, Arial, Helvetica (applied when `data-brand="versigent"` via CSS variables).

## Architecture

```
legacyThemePalettes.ts         ← frozen git palettes (do not edit)
versigentBrand.ts              ← canonical hex tokens from PPTX + derived UI tokens
versigentThemePalettes.ts      ← semantic UI palette
components/versigent/          ← VersigentCopperLines decorative SVG
themeTypes.ts                  ← ThemePalette interface + legacy padding
themePalettes.ts               ← AppTheme union + routing
themeColorUtils.ts             ← brand-tinted shadows from palette hex
themeDesignTokens.ts           ← Versigent typography, radius, derived CSS vars
ThemeContext                   ← applies legacy vs versigent design tokens
```

## Component behaviour

- **Light / Dark:** Original cyan header, system font stack, original button secondary styling
- **Versigent:** Navy gradient header (`#112233` → `#16283F`), white nav tiles with copper active borders, cyan accent glows, cream page background, navy body text, copper secondary buttons, decorative copper circuit lines on header and page shell. The header circuitry is a dense, static `VersigentCopperLines` field: stepped traces fanning in from both edges plus the logo↔nav and nav↔user gaps, top-edge brackets, a dashed lower baseline, and junction vias/pads. Main traces use a brighter "hot" copper tint (`lighten(brandCopper, 0.38)`) with a soft `feGaussianBlur` glow.

See `frontend/src/lib/versigentBrand.ts` and `frontend/src/lib/versigentThemePalettes.ts` for implementation.
