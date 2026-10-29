import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyCurrentSlaveBoot } from './bootProof.mjs'

const args = { baseUrl: 'http://192.168.10.2:3174/api', token: 'a'.repeat(40),
  deviceId: 'vision-slave', slaveBootId: 'boot-1', ledgerId: 'ledger-1' }
const proof = { deviceId: 'vision-slave', slaveBootId: 'boot-1', ledgerId: 'ledger-1',
  ledgerDiscontinuity: false, sharedSchemaConfirmed: true,
  productionSynchronizationEnabled: true, inspectionAuthorizationEnabled: true,
  endpoints: ['/api/vision-sync/runs'] }

test('current authenticated Slave boot and ledger are required', async () => {
  let url
  let auth
  const fetcher = async (input, options) => {
    url = String(input); auth = options.headers.Authorization
    return { ok: true, redirected: false, url,
      json: async () => proof }
  }
  assert.equal(await verifyCurrentSlaveBoot({ ...args, fetcher }), true)
  assert.equal(url, 'http://192.168.10.2:3174/api/vision-sync/capabilities')
  assert.equal(auth, `Bearer ${args.token}`)
  for (const changed of [{ slaveBootId: 'old' }, { ledgerDiscontinuity: true },
    { productionSynchronizationEnabled: false }, { inspectionAuthorizationEnabled: false }]) {
    assert.equal(await verifyCurrentSlaveBoot({ ...args, fetcher: async () => ({
      ok: true, redirected: false, url,
      json: async () => ({ ...proof, ...changed }),
    }) }), false)
  }
  await assert.rejects(() => verifyCurrentSlaveBoot({ ...args, token: '', fetcher }),
    { code: 'BOOT_PROOF_UNAVAILABLE' })
})
