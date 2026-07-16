/**
 * Express routes for the Settings framework.
 */
import { getDomain } from './domainRegistry.mjs'
import { settingsErrorResponse, SettingsError } from './errors.mjs'

/**
 * @param {object} deps
 */
export function createSettingsRouter({
  express,
  settings,
  optionalAuth,
  requireAuth,
  requireAdmin,
  machineOp,
  hasSettingsTabAccess,
  rank,
  adminMinRank,
}) {
  const router = express.Router()

  function authCtx(req) {
    return {
      userRow: req.userRow,
      userId: req.userRow?.id,
      username: req.userRow?.username,
      isMachineOperationAllowed: machineOp.isMachineOperationAllowed(req),
      hasSettingsTabAccess: (tab) => hasSettingsTabAccess(req, tab),
      rank,
      adminMinRank,
    }
  }

  function handle(err, res) {
    const { status, body } = settingsErrorResponse(err)
    return res.status(status).json(body)
  }

  router.get('/', optionalAuth, (req, res) => {
    try {
      const r = rank(req.userRow)
      res.json({
        status: 'success',
        data: {
          frameworkSchemaVersion: settings.FRAMEWORK_SCHEMA_VERSION,
          domains: settings.catalogForCaller({
            canSeeHigh: Boolean(req.userRow),
            canSeeAdmin: r >= adminMinRank,
          }),
        },
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.get('/audit', requireAuth, requireAdmin, (req, res) => {
    try {
      res.json({
        status: 'success',
        data: settings.queryAudit({
          domain: req.query.domain ? String(req.query.domain) : undefined,
          limit: req.query.limit,
          offset: req.query.offset,
        }),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.get('/export', requireAuth, requireAdmin, (req, res) => {
    try {
      const domains = req.query.domains
        ? String(req.query.domains).split(',').map((s) => s.trim()).filter(Boolean)
        : null
      const includeSecrets = String(req.query.includeSecrets || '') === '1'
      res.json({
        status: 'success',
        data: settings.exportPackage({ domains, includeSecrets }),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.post('/import', requireAuth, requireAdmin, (req, res) => {
    try {
      const dryRun = req.body?.dryRun !== false
      const result = settings.importPackage(req.body?.package || req.body, {
        dryRun,
        ctx: authCtx(req),
      })
      res.json({ status: 'success', data: result })
    } catch (err) {
      handle(err, res)
    }
  })

  router.post('/backup', requireAuth, requireAdmin, (req, res) => {
    try {
      res.json({
        status: 'success',
        data: settings.createBackup({
          includeSecrets: Boolean(req.body?.includeSecrets),
        }),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.get('/backups', requireAuth, requireAdmin, (_req, res) => {
    try {
      res.json({ status: 'success', data: settings.listBackups() })
    } catch (err) {
      handle(err, res)
    }
  })

  router.post('/restore', requireAuth, requireAdmin, (req, res) => {
    try {
      const filePath = req.body?.path || req.body?.backup_path
      if (!filePath) {
        throw new SettingsError('VALIDATION', 'path is required', { status: 400 })
      }
      res.json({
        status: 'success',
        data: settings.restoreFromPath(String(filePath), authCtx(req)),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.post('/reset', requireAuth, requireAdmin, (req, res) => {
    try {
      res.json({
        status: 'success',
        data: settings.resetAll({ ...authCtx(req), reason: req.body?.reason }),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.post('/:domain/reset', requireAuth, (req, res) => {
    try {
      const domainId = req.params.domain
      const ctx = authCtx(req)
      const decision = settings.authorizeDomainReset(domainId, ctx)
      if (!decision.ok) {
        return res.status(decision.status).json({
          status: 'error',
          error: { code: 'FORBIDDEN', message: decision.message },
        })
      }
      res.json({
        status: 'success',
        data: settings.resetDomain(domainId, { ...ctx, reason: req.body?.reason }),
      })
    } catch (err) {
      handle(err, res)
    }
  })

  router.get('/:domain', optionalAuth, (req, res) => {
    try {
      const domainId = req.params.domain
      const descriptor = getDomain(domainId)
      if (!descriptor) {
        throw new SettingsError('UNKNOWN_DOMAIN', `Unknown domain: ${domainId}`, { status: 404 })
      }
      const doc = settings.getDomainDocument(domainId)
      const r = rank(req.userRow)

      if ((doc.sensitivity === 'admin' || doc.sensitivity === 'bypass') && r < adminMinRank) {
        return res.status(403).json({
          status: 'error',
          error: { code: 'FORBIDDEN', message: 'Admin access required' },
        })
      }

      if ((doc.sensitivity === 'high' || doc.sensitivity === 'secret') && !req.userRow) {
        const projected = descriptor.publicProjection?.(doc.data) ?? {}
        return res.json({
          status: 'success',
          data: {
            domain: domainId,
            schemaVersion: doc.schemaVersion,
            etag: doc.etag,
            data: projected,
            public: true,
          },
        })
      }

      res.setHeader('ETag', doc.etag)
      res.json({ status: 'success', data: doc })
    } catch (err) {
      handle(err, res)
    }
  })

  router.patch('/:domain', optionalAuth, (req, res) => {
    try {
      const domainId = req.params.domain
      const ctx = authCtx(req)
      const ifMatch = req.get('If-Match') || req.body?.ifMatch || null
      const patchBody = req.body?.data !== undefined ? req.body.data : req.body
      const decision = settings.authorizeDomainPatch(domainId, patchBody, ctx)
      if (!decision.ok) {
        return res.status(decision.status).json({
          status: 'error',
          error: { code: decision.status === 400 ? 'EMPTY_PATCH' : 'FORBIDDEN', message: decision.message },
        })
      }
      const result = settings.patchDomain(domainId, patchBody, {
        ...ctx,
        ifMatch,
        reason: req.body?.reason,
      })
      res.setHeader('ETag', result.etag)
      res.json({ status: 'success', data: result })
    } catch (err) {
      handle(err, res)
    }
  })

  return router
}
