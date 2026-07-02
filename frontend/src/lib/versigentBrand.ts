/**
 * Versigent official brand tokens — sourced from
 * `Centering system USW.pptx` → theme `Versigent_Color_Palette_Official`
 * (`ppt/theme/theme3.xml`, clrScheme name `Versigent_Color_Palette_Official`).
 *
 * Typography: Arial (major + minor font scheme in the deck).
 * Data / chart series order: accent1 → accent6 (see chartSeries).
 * Hyperlinks: accent5 gold; visited: folHlink bronze.
 * Secondary brand mark: dk2 copper.
 * Headings / dark chrome: lt2 navy.
 */
export const versigentBrand = {
  /** accent1 — primary actions, key UI chrome */
  blue: '#0857C3',
  blueDark: '#064A9E',
  blueDarker: '#053D85',
  /** accent2 — highlights, info states, secondary emphasis */
  cyan: '#74D2E7',
  cyanDark: '#4BB8D4',
  /** accent3 — success / positive / operational OK */
  green: '#004624',
  /** accent4 — chart series / bright positive highlight */
  greenBright: '#79DD05',
  /** folHlink — visited links, warm secondary accent */
  bronze: '#CB9552',
  /** dk2 — logo copper, secondary brand mark */
  copper: '#CD7925',
  copperDark: '#B5651D',
  /** accent5 — warnings, hyperlinks */
  gold: '#F7A900',
  goldDark: '#D99200',
  /** lt2 — navy: headings, dark surfaces, header chrome */
  navy: '#16283F',
  navyDark: '#0D1824',
  navyLight: '#1E3044',
  /** GIF hero gradient stop — darker navy field */
  navyDeep: '#112233',
  /** accent6 — page background tint */
  cream: '#FBFAF6',
  /** Neutrals (lt1/dk1 in official scheme) */
  white: '#FFFFFF',
  black: '#000000',
  /** Derived UI neutrals (masters / UI, not in theme3) */
  muted: '#929D96',
  mutedDark: '#878F84',
  borderWarm: '#E5E1DA',
  wordmarkDark: '#030303',
  /** Industrial error (not in deck accents; chosen for WCAG on cream surfaces) */
  error: '#C13B33',
  errorDark: '#9E2F28',
  /** Official accent order for charts and data visualization */
  chartSeries: ['#0857C3', '#74D2E7', '#004624', '#79DD05', '#F7A900', '#FBFAF6'] as const,
  /** Official hyperlink colors from the deck */
  link: '#F7A900',
  linkVisited: '#CB9552',
} as const

export const versigentTypography = {
  fontFamily: "'Akkurat Pro', Arial, Helvetica, sans-serif",
  fontFamilyMono: "ui-monospace, 'Cascadia Code', 'Segoe UI Mono', Consolas, monospace",
} as const

export const versigentElevation = {
  radiusSm: '6px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusXl: '14px',
  shadowCardLight: '0 1px 2px rgba(22, 40, 63, 0.06), 0 2px 10px rgba(22, 40, 63, 0.08)',
  shadowCardDark: '0 4px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  shadowDialog: '0 12px 40px rgba(22, 40, 63, 0.22)',
  shadowHeader: '0 2px 12px rgba(13, 24, 36, 0.35)',
} as const
