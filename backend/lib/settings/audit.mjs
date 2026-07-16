/**
 * Settings audit persistence.
 */

export function ensureAuditTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      actor_user_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_settings_audit_domain_created
      ON settings_audit (domain, created_at DESC);
  `)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} entry
 */
export function insertAudit(db, entry) {
  ensureAuditTable(db)
  db.prepare(`
    INSERT INTO settings_audit
      (domain, actor_user_id, actor_username, action, before_json, after_json, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.domain,
    entry.actorUserId ?? null,
    entry.actorUsername ?? null,
    entry.action,
    entry.beforeJson != null ? JSON.stringify(entry.beforeJson) : null,
    entry.afterJson != null ? JSON.stringify(entry.afterJson) : null,
    entry.reason ?? null,
    entry.createdAt || new Date().toISOString(),
  )
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ domain?: string, limit?: number, offset?: number }} [query]
 */
export function queryAudit(db, query = {}) {
  ensureAuditTable(db)
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)
  if (query.domain) {
    return db.prepare(`
      SELECT id, domain, actor_user_id, actor_username, action, before_json, after_json, reason, created_at
      FROM settings_audit
      WHERE domain = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(query.domain, limit, offset)
  }
  return db.prepare(`
    SELECT id, domain, actor_user_id, actor_username, action, before_json, after_json, reason, created_at
    FROM settings_audit
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset)
}
