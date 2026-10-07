/**
 * Start pulse (requirements §7.3, V2-REQ-100 … 103).
 *
 * On Start, Class A and Class B run two things together:
 *   1. the production steps, in their usual order;
 *   2. the existing height move to the loaded h_pre_mm on centring_axis.
 *
 * The jaws are already at H_PRE, so the Nano attaches the servos at that pulse
 * and finishes the move at once; its idle detach (kIdleDetachMs, 1.5 s)
 * releases the signal. There is no host timer and no new Nano command: the
 * steps never wait for the move reply, and the 1.5 s never waits for the steps.
 *
 * The move is sent only when centring runs, centring_axis is both (single-axis
 * Start is refused), the length class is A or B, and every centring axis is
 * H_PRE on the Start STATUS. Otherwise the cycle owns recovery and nothing is
 * sent here.
 *
 * The reply is not a step. Once the steps have moved on, its outcome is
 * ignored — except a link or E-stop failure, which always surfaces.
 */
import { heightMoveFromSettings } from './position.mjs'
import { classifyLengthClass, lEffFromRecipe } from './lengthClass.mjs'
import { centringRestState } from './restGate.mjs'

const MOVE_METHOD = Object.freeze({ MOVEBOTHMM: 'moveBoth', MOVE_UPPERMM: 'moveUpper', MOVE_LOWERMM: 'moveLower' })

/**
 * Whether Start sends the h_pre move, and which.
 * @param {object} p
 * @param {object|null} p.reference — loaded recipe
 * @param {object|null} p.status — STATUS read at Start (production preflight)
 * @param {boolean} [p.skipCentring=false]
 * @param {object|null} [p.slaveCal]
 * @param {number} [p.mechOffsetMm=0]
 * @param {number} [p.toleranceDeg]
 * @returns {{ send: true, command: string, method: string, hMm: number }
 *   | { send: false, reason: string }}
 */
export function startPulsePlan({ reference, status, skipCentring = false, slaveCal = null, mechOffsetMm = 0, toleranceDeg }) {
  if (skipCentring) return { send: false, reason: 'CENTRING_SKIPPED' }
  if (!classifyLengthClass(lEffFromRecipe(reference)).ok) return { send: false, reason: 'LENGTH_CLASS_INVALID' }
  const rest = centringRestState({ status, reference, slaveCal, mechOffsetMm, toleranceDeg })
  if (!rest.ready) return { send: false, reason: rest.code }
  const { command, hMm } = heightMoveFromSettings(reference, 'close')
  return { send: true, command, method: MOVE_METHOD[command], hMm }
}

/** Link loss or E-stop: these always surface, even after the steps moved on. */
export function isLinkOrEstopFailure(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /estop|e-stop/i.test(msg)
    || /link lost|link_lost|TCP closed|no TCP session|unreachable/i.test(msg)
    || /ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|connect (timeout|failed)/i.test(msg)
}

/**
 * Send the planned move without waiting for it.
 * @param {object} master — centring master port (`moveBoth` / `moveUpper` / `moveLower`)
 * @param {ReturnType<typeof startPulsePlan>} plan
 * @param {{ log?: { info: Function, warn: Function, error: Function }, onLateFault?: (err: Error) => void }} [opts]
 */
export function fireStartPulse(master, plan, { log = console, onLateFault = null } = {}) {
  const handle = {
    sent: false,
    plan,
    settled: false,
    fault: null,
    movedOn: false,
    finished: false,
    /** @type {Promise<void>} */
    done: Promise.resolve(),
    /** Steps began: from now on only link / E-stop failures matter. */
    markMovedOn() { handle.movedOn = true },
    /** Steps ended: a later link / E-stop failure goes to onLateFault. */
    markFinished() { handle.movedOn = true; handle.finished = true },
    /** Throw the pending fault, if any (between steps and after the last one). */
    throwIfFault() {
      if (handle.fault) throw handle.fault
    },
  }
  if (!plan?.send) return handle

  const fault = (err, why) => {
    const e = err instanceof Error ? err : new Error(String(err))
    e.message = `Centring Start pulse (${plan.command} ${plan.hMm} mm) failed: ${e.message}`
    e.code = e.code ?? 'START_PULSE_FAILED'
    log.error(`[centring] ${e.message} — ${why}`)
    if (handle.finished) onLateFault?.(e)
    else handle.fault = e
  }

  handle.sent = true
  log.info(`[centring] Start pulse: ${plan.command} ${plan.hMm} mm (servo release by the Nano idle detach)`)
  let pending
  try {
    pending = Promise.resolve(master[plan.method](plan.hMm))
  } catch (err) {
    pending = Promise.reject(err)
  }
  handle.done = pending.then(
    () => { handle.settled = true },
    (err) => {
      handle.settled = true
      if (isLinkOrEstopFailure(err)) {
        fault(err, 'link or E-stop failure surfaces even after the steps moved on')
      } else if (!handle.movedOn) {
        fault(err, 'the steps had not started')
      } else {
        log.warn(`[centring] Start pulse reply ignored (steps moved on): ${err instanceof Error ? err.message : err}`)
      }
    },
  )
  return handle
}

/**
 * Start runner: fire the Start pulse, then run the steps in order without
 * waiting for its reply. A link / E-stop failure of the pulse stops the run at
 * the next step boundary.
 * @param {object} p
 * @param {Array<{ name: string, run: () => Promise<void> }>} p.steps
 * @param {object} p.master
 * @param {ReturnType<typeof startPulsePlan>} p.plan
 * @param {() => void} [p.beforeStep] — e.g. stop-request check
 * @param {object} [p.log]
 * @param {(err: Error) => void} [p.onLateFault]
 * @returns {Promise<{ pulse: ReturnType<typeof fireStartPulse> }>}
 */
export async function runStartWithPulse({ steps, master, plan, beforeStep = () => {}, log = console, onLateFault = null }) {
  const pulse = fireStartPulse(master, plan, { log, onLateFault })
  try {
    for (const step of steps) {
      beforeStep()
      pulse.throwIfFault()
      pulse.markMovedOn()
      await step.run()
    }
    pulse.throwIfFault()
  } finally {
    pulse.markFinished()
  }
  return { pulse }
}
