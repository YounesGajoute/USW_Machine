/** Commissioning is deliberately not a production authorization switch. */
export const PRODUCTION_SYNC_COMMISSIONING_BLOCK_REASON =
  'Slave pull synchronization commissioning; production grants are disabled'

export function getVisionSyncMode() {
  const mode = process.env.VISION_SYNC_MODE ?? 'off'
  if (!['off', 'commissioning', 'production'].includes(mode)) {
    throw new Error('VISION_SYNC_MODE must be off, commissioning or production')
  }
  return mode
}

export function isVisionSyncCommissioning() {
  return getVisionSyncMode() === 'commissioning'
}

export function isVisionSyncProduction() { return getVisionSyncMode() === 'production' }
export function isVisionSyncEnabled() { return getVisionSyncMode() !== 'off' }

export function assertUnversionedVisionAllowed() {
  if (isVisionSyncEnabled()) {
    throw Object.assign(new Error('Unversioned inspection control is disabled during versioned synchronization'), {
      status: 428, code: 'SYNCHRONIZATION_REQUIRED',
    })
  }
}
