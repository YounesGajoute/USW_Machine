import express from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { id, problem, validateRegistration, validateStateRequest, validateAck } from './protocol.mjs'

/** JSON.parse validates syntax; a token pass rejects duplicate object members. */
export function parseStrictJson(text) {
  if (typeof text !== 'string') throw problem('VALIDATION_ERROR', 'An application/json body is required', 422)
  let parsed
  try { parsed = JSON.parse(text) } catch { throw problem('VALIDATION_ERROR', 'Malformed JSON', 422) }
  const containers = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') containers.push(new Set())
    else if (ch === '[') containers.push(null)
    else if (ch === '}' || ch === ']') containers.pop()
    else if (ch === '"') {
      const start = i++
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++ }
      let next = i + 1
      while (/\s/.test(text[next] ?? '') && next < text.length) next++
      if (text[next] === ':' && containers.at(-1)) {
        const key = JSON.parse(text.slice(start, i + 1))
        if (containers.at(-1).has(key)) throw problem('VALIDATION_ERROR', 'Duplicate JSON property', 422)
        containers.at(-1).add(key)
      }
    }
  }
  return parsed
}

export function createVisionSyncRouter({
  service,
  getToken = () => undefined,
  getTokenHash = () => undefined,
  getAuthMode = () => 'bearer',
  getAllowedRemoteAddresses = () => undefined,
  isConfigured = () => true,
  production = false,
}) {
  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use((req, _res, next) => {
    try {
      if (!isConfigured()) throw problem('SYNC_NOT_CONFIGURED', 'Master synchronization commissioning is not configured', 503)
      const authMode = String(getAuthMode() ?? 'bearer').trim().toLowerCase()
      if (production && authMode !== 'bearer') {
        throw problem('AUTH_NOT_CONFIGURED', 'Production synchronization requires bearer authentication', 503)
      }
      if (authMode === 'none') {
        const allowed = String(getAllowedRemoteAddresses() ?? '')
          .split(',').map(value => value.trim()).filter(Boolean)
          .map(value => value === '::1' ? '127.0.0.1' : value.replace(/^::ffff:/, ''))
        if (!allowed.length) throw problem('AUTH_NOT_CONFIGURED', 'Device network access is not configured', 503)
        const remote = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1')
        if (!allowed.includes(remote)) throw problem('UNAUTHORIZED', 'Device network address is not permitted', 401)
        next()
        return
      }
      if (authMode !== 'bearer') throw problem('AUTH_NOT_CONFIGURED', 'Device authentication mode is invalid', 503)
      const token = getToken()
      const configuredHash = getTokenHash()
      const hasToken = typeof token === 'string' && token.length > 0
      const hasHash = typeof configuredHash === 'string' && configuredHash.length > 0
      if (!hasToken && !hasHash) throw problem('AUTH_NOT_CONFIGURED', 'Device authentication is not configured', 503)
      if (production && hasToken && token.length < 32) {
        throw problem('AUTH_NOT_CONFIGURED', 'Production device token must contain at least 32 characters', 503)
      }
      if (hasHash && !/^[a-f0-9]{64}$/i.test(configuredHash)) {
        throw problem('AUTH_NOT_CONFIGURED', 'Device authentication is not configured', 503)
      }
      const authorization = req.get('authorization') ?? ''
      const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
      const hash = value => createHash('sha256').update(value).digest()
      const expected = hasHash ? Buffer.from(configuredHash, 'hex') : hash(token)
      if (hasToken && hasHash && !timingSafeEqual(hash(token), expected)) {
        throw problem('AUTH_NOT_CONFIGURED', 'Device authentication is not configured', 503)
      }
      if (!supplied || !timingSafeEqual(hash(supplied), expected)) throw problem('UNAUTHORIZED', 'Invalid device credentials', 401)
      next()
    } catch (error) { next(error) }
  })
  router.use(express.text({ type: 'application/json', limit: '64kb' }))
  const route = fn => (req, res, next) => {
    Promise.resolve().then(() => fn(req, res)).catch(next)
  }
  function identity(req, identity, required = false) {
    const device = req.get('X-Vision-Device-Id')
    const boot = req.get('X-Vision-Slave-Boot-Id')
    if (required) { id(device, 'X-Vision-Device-Id'); id(boot, 'X-Vision-Slave-Boot-Id') }
    if ((device !== undefined && device !== identity.deviceId) ||
        (boot !== undefined && boot !== identity.slaveBootId)) throw problem('IDENTITY_MISMATCH', 'Header and message identity differ', 403)
    if (identity.deviceId !== service.deviceId) throw problem('DEVICE_MISMATCH', 'Device is not configured for this Master', 403)
  }
  router.get('/capabilities', route((req, res) => {
    identity(req, { deviceId: service.deviceId, slaveBootId: req.get('X-Vision-Slave-Boot-Id') }, true)
    res.json(service.capabilities())
  }))
  router.post('/sessions', route(async (req, res) => {
    const body = parseStrictJson(req.body)
    validateRegistration(body)
    identity(req, body ?? {})
    const result = service.register(body)
    await service.verifyBoot(body)
    res.status(result.created ? 201 : 200).json(result.response)
  }))
  router.get('/state', route((req, res) => {
    // Wire decision: exactly the fixture stateRequest as scalar query parameters.
    const request = { ...req.query }
    if (request.protocolVersion === '1') request.protocolVersion = 1
    validateStateRequest(request)
    identity(req, request)
    res.json(service.state(request))
  }))
  router.post('/ack', route((req, res) => {
    const body = parseStrictJson(req.body)
    validateAck(body)
    identity(req, body?.binding ?? {})
    res.json(service.ack(body))
  }))
  router.use((_req, _res, next) => next(problem('NOT_FOUND', 'Unknown synchronization endpoint', 404)))
  router.use((error, _req, res, _next) => {
    const known = typeof error.code === 'string' && Number.isInteger(error.status)
    const status = error.type === 'entity.too.large' ? 413 : known ? error.status : 503
    res.status(status).json({ error: {
      code: status === 413 ? 'PAYLOAD_TOO_LARGE' : known ? error.code : 'SYNC_UNAVAILABLE',
      message: status === 413 ? 'Synchronization payload exceeds 64kb' : known ? error.message : 'Synchronization service unavailable',
    } })
  })
  return router
}
