import { setPneumaticOutputs } from './pneumatics.mjs'
import { armClampTriggerRearmAfterBothValvesOpen } from './clampTriggerMode.mjs'

/** Ordered product release only: no axis moves, STOP, HOME, or safety reset. */
export async function releaseVisionRejectedProduct(ecm, {
  timing, phases, assertCanRelease, publishPhase,
  write = setPneumaticOutputs,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  rearmClamps = armClampTriggerRearmAfterBothValvesOpen,
}) {
  const steps = [
    ['vision_reject_pp_clamp_open', { ppClamp: false }, timing.delayAfterPickClampOpenMs],
    ['vision_reject_lever_down', { leverUp: false }, timing.delayAfterLeverDownMs],
    ['vision_reject_clamps_open', { clampRight: false, clampLeft: false }, timing.delayAfterClampOpenMs],
  ]
  for (const [phase, outputs, delay] of steps) {
    await assertCanRelease()
    await publishPhase(phase)
    // Publishing yields: a Stop or safety trip may have arrived meanwhile.
    await assertCanRelease()
    await write(ecm, outputs)
    phases.push({ phase, outputs })
    if (phase === 'vision_reject_clamps_open') rearmClamps()
    await wait(delay)
  }
  await assertCanRelease()
}
