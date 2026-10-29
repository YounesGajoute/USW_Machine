export type VisionSettingsSaveFeedback = {
  tone: 'info' | 'warning' | 'success'
  summary: string
  message: string
}
export function visionSyncIssueMessage(issue: string): string
export function visionSettingsSaveFeedback(result: {
  synced: boolean
  sync_state?: 'awaiting_slave' | 'not_configured'
  sync_error?: string
}): VisionSettingsSaveFeedback
export function visionSettingsSyncFeedback(status: {
  state: 'disconnected' | 'pending' | 'synchronized' | 'blocked' | 'failed'
  desiredMode: 'enabled' | 'disabled' | 'hold' | null
  issues: string[]
  productionAuthorized?: boolean
} | null): VisionSettingsSaveFeedback | null
