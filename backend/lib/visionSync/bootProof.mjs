import { problem } from './protocol.mjs'

/** Authenticate the currently running Slave boot before issuing any grant. */
export async function verifyCurrentSlaveBoot({ baseUrl, token, deviceId, slaveBootId, ledgerId,
  fetcher = fetch, timeoutMs = 3000 }) {
  if (typeof token !== 'string' || token.length < 32) {
    throw problem('BOOT_PROOF_UNAVAILABLE', 'Production synchronization requires a private bearer token', 503)
  }
  const base = new URL(baseUrl)
  if (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) {
    throw problem('BOOT_PROOF_UNAVAILABLE', 'Invalid Vision Slave origin', 503)
  }
  const url = new URL(`${base.pathname.replace(/\/$/, '')}/vision-sync/capabilities`, base.origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { redirect: 'error', cache: 'no-store',
      signal: controller.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    if (!response.ok || response.redirected || response.url && new URL(response.url).origin !== base.origin) {
      throw problem('BOOT_PROOF_FAILED', 'Vision Slave boot proof was rejected', 503)
    }
    const proof = await response.json()
    return proof?.deviceId === deviceId && proof?.slaveBootId === slaveBootId &&
      proof?.ledgerId === ledgerId && proof?.ledgerDiscontinuity === false &&
      proof?.sharedSchemaConfirmed === true && proof?.productionSynchronizationEnabled === true &&
      proof?.inspectionAuthorizationEnabled === true &&
      Array.isArray(proof?.endpoints) && proof.endpoints.includes('/api/vision-sync/runs')
  } catch (error) {
    if (error?.code === 'BOOT_PROOF_FAILED') throw error
    throw problem('BOOT_PROOF_FAILED', 'Current Vision Slave boot proof is unavailable', 503)
  } finally { clearTimeout(timer) }
}
