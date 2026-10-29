import { randomUUID } from 'node:crypto'
import { CONTRACT_ID, SESSION_KEYS, canonical, id, revision, problem,
  validateRegistration, validateStateRequest, validateAck } from './protocol.mjs'

const GRANT_DURATION_MS = 10_000
const GRANT_SAFETY_MS = 250
const GRANT_RENEW_MS = 3_000

/** Versioned authority; production is opt-in and requires verified Slave boot proof. */
export function createVisionSyncService({ store, getSelection,
  masterId = 'us-machine', deviceId = 'vision-slave', bootId = randomUUID(),
  uuid = randomUUID, getServiceState = () => 'ready', getPolicyIssues = () => [],
  production = false, verifySlaveBoot = null, now = () => Date.now() }) {
  id(masterId, 'masterId'); id(deviceId, 'deviceId'); id(bootId, 'masterBootId')
  let generation = 0n
  let desiredRevision = 0n
  let snapshotSequence = 0n
  let lastDesiredKey = null
  let lastSnapshotKey = null
  let current = null
  let statusRequestSequence = 0n
  const registrations = new Map()
  const retiredBoots = new Set()

  function assertDevice(value) {
    if (value !== deviceId) throw problem('DEVICE_MISMATCH', 'Device is not configured for this Master', 403)
  }
  function sessionMatches(value) {
    if (!current || SESSION_KEYS.some(key => value[key] !== current.session[key])) {
      throw problem('SESSION_REPLACED', 'Register a new session with the current Master')
    }
  }
  function snapshot(requestId) {
    const selection = getSelection()
    revision(selection.selectionRevision, 'selectionRevision')
    if (selection.referenceId !== null) id(selection.referenceId, 'referenceId')
    const serviceState = getServiceState()
    if (!['initializing', 'ready', 'error'].includes(serviceState)) throw new Error('Invalid internal service state')
    let desired = serviceState === 'ready' ? store.readDesired(selection.referenceId) : {
      referenceId: null, referenceName: null, recipeRevision: null, recipeDigest: null,
      requiredByReference: null, desiredMode: 'hold', recipe: null, issues: ['MASTER_NOT_READY'],
    }
    const policyIssues = [...getPolicyIssues(), ...(current.discontinuity ? ['LEDGER_DISCONTINUITY_REVIEW_REQUIRED'] : [])]
    if (policyIssues.length) desired = { ...desired, desiredMode: 'hold', recipe: null, recipeDigest: null,
      issues: [...desired.issues, ...policyIssues] }
    const { referenceName: _name, ...authority } = desired
    const key = canonical({ serviceState, selectionRevision: selection.selectionRevision, ...authority })
    // Never compare numeric strings lexically. Reference names are metadata only.
    if (key !== lastDesiredKey) { desiredRevision++; lastDesiredKey = key }
    const binding = desired.desiredMode === 'hold' ? null : {
      ...current.session, selectionRevision: selection.selectionRevision,
      desiredRevision: String(desiredRevision), referenceId: desired.referenceId,
      recipeRevision: desired.recipeRevision, recipeDigest: desired.recipeDigest,
    }
    const content = { serviceState, binding, requiredByReference: desired.requiredByReference,
      desiredMode: desired.desiredMode, referenceName: desired.referenceName,
      recipe: desired.recipe, issues: desired.issues }
    const snapshotKey = canonical(content)
    if (snapshotKey !== lastSnapshotKey) { snapshotSequence++; lastSnapshotKey = snapshotKey }
    return { protocolVersion: 1, contractId: CONTRACT_ID, snapshotSequence: String(snapshotSequence), requestId, ...content }
  }
  function executionTicket() {
    if (!production || !current?.bootVerified || !current.grant?.installed ||
        current.grant.deadline <= now() + GRANT_SAFETY_MS || current.discontinuity) return null
    const state = snapshot(`ticket-${++statusRequestSequence}`)
    const report = current.lastReport ? JSON.parse(current.lastReport.request) : null
    const { localRevision: _localRevision, ...reportedBinding } = report?.binding ?? {}
    if (!state.binding || state.desiredMode !== 'enabled' || state.issues.length ||
        !report || report.phase !== 'ready' || !report.enabled || !report.locallyReady ||
        report.busy || report.active || report.issues.length ||
        canonical(reportedBinding) !== canonical(state.binding) ||
        current.grant.binding !== canonical(state.binding) ||
        current.grant.localRevision !== report.binding.localRevision ||
        current.grant.ledgerId !== current.ledgerId) return null
    return { binding: structuredClone(report.binding), grantId: current.grant.id,
      ledgerId: current.ledgerId, localRevision: report.binding.localRevision,
      expiresAt: current.grant.deadline }
  }
  return {
    deviceId,
    executionTicket,
    async verifyBoot(request) {
      if (!production) return true
      if (typeof verifySlaveBoot !== 'function') throw problem('BOOT_PROOF_UNAVAILABLE', 'Current Slave boot proof is not configured', 503)
      const sessionId = current?.session.sessionId
      if (!sessionId || current.session.slaveBootId !== request.slaveBootId || current.ledgerId !== request.ledgerId) {
        throw problem('SESSION_REPLACED', 'Slave session changed before boot verification')
      }
      const verified = await verifySlaveBoot(request)
      if (!verified) throw problem('BOOT_PROOF_FAILED', 'Current Slave boot could not be verified', 503)
      if (current?.session.sessionId !== sessionId) throw problem('SESSION_REPLACED', 'Slave session changed during boot verification')
      current.bootVerified = true
      return true
    },
    status() {
      if (!current) return {
        state: 'disconnected', connected: false, synchronized: false,
        desiredMode: null, referenceId: null, recipeRevision: null,
        phase: null, productionAuthorized: false, issues: [],
      }
      const state = snapshot(`status-${++statusRequestSequence}`)
      let report = null
      try { report = current.lastReport ? JSON.parse(current.lastReport.request) : null } catch { report = null }
      const { localRevision: _localRevision, ...reportedBinding } = report?.binding ?? {}
      const bindingMatches = !!(state.binding && report?.binding && canonical(reportedBinding) === canonical(state.binding))
      const synchronized = bindingMatches && (
        (state.desiredMode === 'enabled' && report.phase === 'ready' && report.enabled && report.locallyReady && !report.busy) ||
        (state.desiredMode === 'disabled' && report.phase === 'disabled' && !report.enabled && !report.busy)
      )
      const reportIssues = Array.isArray(report?.issues) ? report.issues : []
      return {
        state: state.desiredMode === 'hold' ? 'blocked'
          : synchronized ? 'synchronized'
            : report?.phase === 'failed' ? 'failed' : 'pending',
        connected: true,
        synchronized,
        desiredMode: state.desiredMode,
        referenceId: state.binding?.referenceId ?? getSelection().referenceId,
        recipeRevision: state.binding?.recipeRevision ?? null,
        phase: bindingMatches ? report?.phase ?? null : null,
        productionAuthorized: !!executionTicket(),
        issues: [...new Set([...(state.issues ?? []), ...reportIssues])],
      }
    },
    capabilities() {
      return { protocolVersion: 1, contractId: CONTRACT_ID, masterId, roles: ['master'],
        capabilities: production ? ['sessions', 'state', 'ack', 'versioned-runs'] : ['sessions', 'state', 'ack'] }
    },
    register(request) {
      validateRegistration(request); assertDevice(request.deviceId)
      const serialized = canonical(request)
      const previous = registrations.get(request.requestId)
      if (previous) {
        if (previous.request !== serialized) throw problem('REQUEST_CONFLICT', 'Registration request ID was reused with different content')
        if (previous.response.sessionId !== current?.session.sessionId) throw problem('SESSION_REPLACED', 'Registration belongs to a retired session')
        return { created: false, response: structuredClone(previous.response) }
      }
      if (registrations.size >= 1024) throw problem('SESSION_REGISTRY_FULL', 'Registration capacity reached; operator review required', 503)
      if (retiredBoots.has(request.slaveBootId)) throw problem('STALE_SLAVE_BOOT', 'Slave boot has been retired')
      if (current?.session.slaveBootId === request.slaveBootId && current.ledgerId !== request.ledgerId) {
        throw problem('LEDGER_CHANGED', 'Ledger changed within a Slave boot; restart and reconcile')
      }
      const discontinuity = store.observeLedger(deviceId, request.ledgerId)
      const created = !current || current.session.slaveBootId !== request.slaveBootId
      if (created) {
        if (current) retiredBoots.add(current.session.slaveBootId)
        generation++
        current = { session: { masterId, masterBootId: bootId, deviceId,
          slaveBootId: request.slaveBootId, sessionId: uuid(), sessionGeneration: String(generation) },
        ledgerId: request.ledgerId, discontinuity, lastReport: null, localRevision: null,
        bootVerified: false, grant: null }
      }
      const response = { protocolVersion: 1, contractId: CONTRACT_ID, requestId: request.requestId, ...current.session }
      registrations.set(request.requestId, { request: serialized, response: structuredClone(response) })
      return { created, response }
    },
    state(request) {
      validateStateRequest(request); assertDevice(request.deviceId); sessionMatches(request)
      return snapshot(request.requestId)
    },
    ack(request) {
      validateAck(request); assertDevice(request.binding.deviceId); sessionMatches(request.binding)
      if (request.ledgerId !== current.ledgerId) throw problem('LEDGER_CHANGED', 'Acknowledgement ledger does not match registration')
      const state = snapshot(request.requestId)
      const { localRevision, ...binding } = request.binding
      if (!state.binding || canonical(binding) !== canonical(state.binding)) throw problem('STALE_BINDING', 'Fetch current authoritative state before acknowledging')
      const serialized = canonical(request)
      const previous = current.lastReport
      if (previous && BigInt(request.reportSequence) < BigInt(previous.sequence)) throw problem('REPORT_OUT_OF_ORDER', 'Report sequence is older than the accepted report')
      if (previous && request.reportSequence === previous.sequence) {
        if (previous.request !== serialized) throw problem('REPORT_CONFLICT', 'Report sequence was reused with changed content')
        return structuredClone(previous.response)
      }
      if (previous?.requestId === request.requestId) throw problem('REQUEST_CONFLICT', 'Use a fresh request ID for each new report')
      if (current.localRevision !== null && BigInt(localRevision) < BigInt(current.localRevision)) {
        throw problem('STALE_LOCAL_REVISION', 'Local revision cannot decrease within a session')
      }
      if (!production && request.installedGrantId !== null) throw problem('PRODUCTION_INHIBITED', 'Commissioning Master issues no grants; installedGrantId must be null')
      if (state.desiredMode === 'disabled' && ['applied', 'loaded', 'ready'].includes(request.phase)) {
        throw problem('INVALID_PHASE', 'Disabled desired state cannot acknowledge a loaded or ready product', 422)
      }
      if (request.phase === 'disabled' && state.desiredMode !== 'disabled') {
        throw problem('INVALID_PHASE', 'Use requested or failed while a required recipe remains disabled', 422)
      }
      current.discontinuity = store.observeLedger(deviceId, request.ledgerId, request.ledgerDiscontinuity)
      const eligible = production && current.bootVerified && !current.discontinuity &&
        state.serviceState === 'ready' && state.desiredMode === 'enabled' &&
        state.issues.length === 0 && request.issues.length === 0 &&
        request.phase === 'ready' && request.enabled && request.locallyReady &&
        !request.active && !request.busy
      const previousGrant = current.grant
      if (!eligible) current.grant = null
      if (request.installedGrantId !== null) {
        // A busy observation may carry the grant used to start the current run.
        // Accept that observation but return no installed grant, so it cannot
        // authorize another admission. Unknown IDs still fail closed.
        const observed = eligible ? current.grant : previousGrant
        if (!observed || observed.id !== request.installedGrantId ||
            (eligible && observed.deadline <= now() + GRANT_SAFETY_MS) ||
            observed.binding !== canonical(state.binding) ||
            observed.localRevision !== localRevision) {
          throw problem('STALE_GRANT', 'Installed grant is expired or does not match the current binding')
        }
        if (eligible) current.grant.installed = true
      }
      let grant = null
      let installedGrantId = null
      if (eligible) {
        if (!current.grant || current.grant.deadline <= now() + GRANT_RENEW_MS ||
            current.grant.binding !== canonical(state.binding) ||
            current.grant.localRevision !== localRevision) {
          current.grant = { id: uuid(), deadline: now() + GRANT_DURATION_MS,
            binding: canonical(state.binding), localRevision, ledgerId: current.ledgerId,
            installed: false }
          grant = { grantId: current.grant.id, durationMs: GRANT_DURATION_MS, purpose: 'production' }
        } else if (!current.grant.installed) {
          grant = { grantId: current.grant.id, durationMs: GRANT_DURATION_MS, purpose: 'production' }
        } else {
          installedGrantId = current.grant.id
        }
      }
      const response = { protocolVersion: 1, contractId: CONTRACT_ID, requestId: request.requestId,
        accepted: true, binding: structuredClone(request.binding), reportSequence: request.reportSequence,
        grant, installedGrantId }
      current.localRevision = localRevision
      current.lastReport = { sequence: request.reportSequence, requestId: request.requestId,
        request: serialized, response: structuredClone(response) }
      return response
    },
  }
}
