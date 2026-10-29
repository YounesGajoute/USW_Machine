/** Keep a Master-initiated camera run distinct from an active production cycle. */
export function createManualVisionRun(dispatch) {
  let active = false
  return {
    isActive: () => active,
    async run(referenceId) {
      if (active) {
        throw Object.assign(new Error('A Master-initiated inspection is already running'), { status: 409 })
      }
      active = true
      try { return await dispatch(referenceId) }
      finally { active = false }
    },
  }
}
