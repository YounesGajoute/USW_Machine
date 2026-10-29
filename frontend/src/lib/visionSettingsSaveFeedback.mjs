/** Persistence, pending synchronization and confirmed application are distinct. */
export function visionSyncIssueMessage(issue) {
  switch (issue) {
    case 'LEDGER_DISCONTINUITY_REVIEW_REQUIRED':
      return 'Vision Slave run history needs review before production.'
    case 'MASTER_NOT_READY':
      return 'Initialize the machine before requesting a production grant.'
    case 'ACTIVE_CYCLE_POLICY_REQUIRED':
      return 'The active cycle needs an approved synchronization policy.'
    default:
      return issue
  }
}

export function visionSettingsSaveFeedback(result) {
  if (result.sync_state === 'awaiting_slave') return {
    tone: 'info', summary: 'Saved on Master · synchronization pending',
    message: 'Saved on the Master. Awaiting Vision Slave synchronization; production inspection remains disabled.',
  }
  if (result.sync_state === 'not_configured') return {
    tone: 'warning', summary: 'Saved on Master · synchronization not configured',
    message: 'Saved on the Master. Master–Slave synchronization is not configured; these changes have not been applied to the Slave. An authorized commissioning setup is required.',
  }
  if (result.synced === true) return {
    tone: 'success', summary: 'Saved and synchronized',
    message: 'Saved on the Master and synchronized with the Vision Slave.',
  }
  // Compatibility with an older Master response: do not turn a timeout, a
  // configuration fault or a failed transfer into a claim that the Slave rejected it.
  return {
    tone: 'warning', summary: 'Saved on Master · synchronization unconfirmed',
    message: `Saved on the Master. Slave synchronization could not be confirmed.${result.sync_error ? ` ${result.sync_error}` : ''}`,
  }
}

/** Translate the Slave's latest accepted acknowledgement into operator status. */
export function visionSettingsSyncFeedback(status) {
  if (!status) return null
  if (status.state === 'synchronized') return {
    tone: 'success', summary: 'Vision Slave synchronized',
    message: status.desiredMode === 'enabled'
      ? `Vision Slave confirmed the current reference configuration. ${status.productionAuthorized === true ? 'Production grant installed.' : 'Production grant is still pending.'}`
      : 'Vision Slave confirmed that inspection is disabled for the current reference.',
  }
  if (status.state === 'blocked' || status.state === 'failed') return {
    tone: 'warning', summary: 'Vision production grant blocked',
    message: `Vision synchronization is blocked.${status.issues?.length ? ` ${status.issues.map(visionSyncIssueMessage).join(' ')}` : ''}`,
  }
  if (status.state === 'disconnected') return {
    tone: 'warning', summary: 'Vision Slave disconnected',
    message: 'Waiting for the Vision Slave to connect.',
  }
  return {
    tone: 'info', summary: 'Vision synchronization pending',
    message: 'The Vision Slave is applying the current reference configuration.',
  }
}
