/** Shared definition of the welding splice inspection region. */
export const WELDING_SPLICE_ZONE =
  'The welded splice zone is the exposed, bare metal area that extends precisely from the cut end of the left cable\'s insulation to the start of the right cable\'s insulation.'

/**
 * What each inline vision check verifies during production.
 * Tool names on the Vision Pi must match `VISION_CHECK_TOOL_NAMES` in the backend.
 */
export const VISION_CHECK_DESCRIPTIONS = {
  welding_splice: {
    length_check:
      'Verifies the welded splice length matches the master image. ' + WELDING_SPLICE_ZONE,
    width_check:
      'Verifies the welded splice width matches the master image. ' + WELDING_SPLICE_ZONE,
    position_check:
      'Verifies the welded splice sits at the expected location. ' + WELDING_SPLICE_ZONE,
  },
  heat_shrink_tube: {
    length_check: 'Verifies the heat-shrink tube length matches the master image.',
    diameter_check: 'Verifies the heat-shrink tube diameter matches the master image.',
    position_check: 'Verifies the heat-shrink tube sits at the expected location.',
  },
} as const

/** Vision Pi tool names — keep in sync with backend/lib/visionChecksConfigStore.mjs */
export const VISION_CHECK_TOOL_LABELS = {
  welding_splice: {
    length_check: 'Welding Splice Length Check',
    width_check: 'Welding Splice Width Check',
    position_check: 'Welding Splice Position Check',
  },
  heat_shrink_tube: {
    length_check: 'Heat-Shrink Tube Length Check',
    diameter_check: 'Heat-Shrink Tube Diameter Check',
    position_check: 'Heat-Shrink Tube Position Check',
  },
} as const
