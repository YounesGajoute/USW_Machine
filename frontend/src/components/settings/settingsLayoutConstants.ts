/**
 * Maximum content width for the settings column.
 * Cards and sections use `width: 100%` and respect this as a soft cap via
 * the parent container — not enforced as a hard pixel lock on each element.
 */
export const SETTINGS_FIXED_WIDTH_PX = 960

/**
 * @deprecated Cards are now auto-height (content-driven).
 * Kept for any legacy callers; do not use for new cards.
 */
export const SETTINGS_SECTION_CARD_HEIGHT_PX = 440

/**
 * @deprecated Cards are now auto-height (content-driven).
 * Kept for any legacy callers; do not use for new cards.
 */
export const SETTINGS_SECTION_CARD_HEIGHT_PRODUCTION_PX = 520

/**
 * @deprecated Cards are now auto-height (content-driven).
 * Kept for any legacy callers; do not use for new cards.
 */
export const SETTINGS_SECTION_CARD_HEIGHT_PLACEHOLDER_PX = 260
