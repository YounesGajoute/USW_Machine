/**
 * Operator text for centring positions (Version 2 requirements §11.1).
 *
 * One sentence per position name, one line per axis. The production screen
 * shows these lines from the status payload; the class A notice and the
 * initialization failure text come from the cycle result, never from here.
 */
import {
  HOME,
  TRAVEL,
  H_PRE,
  H_POST,
  UNKNOWN,
  IN_MOTION,
  NOT_AVAILABLE,
  WIRING,
} from './position.mjs'
import { UNKNOWN_NOTICE } from './cycle.mjs'

export const POSITION_TEXT = Object.freeze({
  [HOME]: 'Open-end limit.',
  [TRAVEL]: 'Close-end limit.',
  [H_PRE]: 'At the reference closing height.',
  [H_POST]: 'At the reference opening height.',
  [UNKNOWN]: 'Error. The centring axis is between the limits and is not at HOME, H_PRE, H_POST, or TRAVEL.',
  [IN_MOTION]: 'Jaw is moving.',
  [NOT_AVAILABLE]: 'Link lost. Wait for the next status.',
  [WIRING]: 'Both switches are pressed on this axis. Check the wiring. Motion is not blocked.',
})

/** Class A: an axis was UNKNOWN and the cycle started initialization. */
export const CLASS_A_UNKNOWN_NOTICE = UNKNOWN_NOTICE

export const INITIALIZATION_FAILED = 'Initialization failed.'

const AXIS_LABEL = Object.freeze({ upper: 'Upper axis', lower: 'Lower axis' })
const AXIS_ORDER = Object.freeze(['upper', 'lower'])

/** Operator sentence for one position name; null for a name that is not a position. */
export function positionText(position) {
  return Object.hasOwn(POSITION_TEXT, position) ? POSITION_TEXT[position] : null
}

/**
 * One line per axis, upper first.
 * @param {{ upper?: string, lower?: string }} positions — position names by axis
 * @returns {Array<{ axis: 'upper'|'lower', position: string, text: string|null, line: string }>}
 */
export function axisPositionLines(positions) {
  const lines = []
  for (const axis of AXIS_ORDER) {
    const position = positions?.[axis]
    if (position == null) continue
    const text = positionText(position)
    lines.push({ axis, position, text, line: `${AXIS_LABEL[axis]}: ${text ?? position}` })
  }
  return lines
}

/**
 * Operator text carried by a centring cycle result: the class A notice when the
 * cycle started initialization, and its failure message when that failed.
 * @param {{ ok?: boolean, notice?: string, message?: string } | null | undefined} result
 * @returns {{ notice: string|null, message: string|null } | null}
 */
export function cycleOperatorText(result) {
  const notice = result?.notice ?? null
  if (!notice) return null
  if (result.ok !== false) return { notice, message: null }
  const why = String(result.message ?? '').trim()
  const message = why.startsWith(INITIALIZATION_FAILED)
    ? why
    : `${INITIALIZATION_FAILED} ${why || 'The centring controller did not report why.'}`
  return { notice, message }
}
