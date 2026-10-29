/** Volatile record that this selection was written and drained on each required serial port. */
let delivered = null

export function recordReferenceSerialDelivery({ referenceId, selectionRevision, required, sentTo }) {
  delivered = {
    referenceId,
    selectionRevision,
    required: [...required],
    sentTo: [...sentTo],
  }
}

export function getReferenceSerialDeliveryBlockReason({ referenceId, selectionRevision, required }) {
  if (!required.length) return null
  if (!delivered || delivered.referenceId !== referenceId ||
      delivered.selectionRevision !== selectionRevision ||
      required.some(port => !delivered.required.includes(port))) {
    return `Reference has not been sent to ${required.join(' and ')} for this load; scan the reference again after checking the serial adapters`
  }
  const missing = required.filter(port => !delivered.sentTo.includes(port))
  return missing.length
    ? `Reference was not sent to ${missing.join(' and ')}; reconnect the correct serial adapter and scan the reference again`
    : null
}
