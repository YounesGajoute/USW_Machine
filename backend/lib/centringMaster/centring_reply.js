/** Serialized command reply reader. A previous STATUS is not an acknowledgement. */
export async function readCentringCommandReply(command, {
  readStatus,
  acknowledgementTimeoutMs,
  completionTimeoutMs,
  now = Date.now,
}) {
  const expected = String(command).trim().split(/\s+/)[0]
  let deadline = now() + acknowledgementTimeoutMs
  let acknowledged = false
  try {
    while (now() < deadline) {
      const st = await readStatus(Math.max(1, deadline - now()))
      if (st?.lastCmd !== expected) continue
      // A rejection while another motion is busy is not an accepted move.
      if (st.accepted === false || !st.busy) return st
      if (!acknowledged) {
        acknowledged = true
        deadline = now() + completionTimeoutMs
      }
    }
    throw new Error('reply deadline exceeded')
  } catch (cause) {
    const err = new Error(`Centring unconfirmed command reply for ${expected}: ${cause.message}`)
    err.code = 'CENTRING_REPLY_UNCERTAIN'
    err.cause = cause
    throw err
  }
}
