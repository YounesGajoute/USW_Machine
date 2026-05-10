/**
 * Local Authentication Service
 *
 * Provides a fully self-contained user store backed by localStorage.
 * Works without any backend server – ideal for standalone / touchscreen deployments.
 *
 * Security notes
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Passwords are hashed with PBKDF2-SHA-256 (10 000 iterations) + random salt.
 *  • Credentials never leave the device when using local auth.
 *  • For multi-device / server deployments replace this with real backend auth.
 *
 * Default users (seeded once on first run) are defined in `config/default-users.json`
 * (username, password, role, active flag, hidden-from-customer, login hints).
 */

import type { Role, User } from '@/types/auth.types'
import { migrateStoredRoleValue } from '@/lib/legacyRoleNames'
import { getBuiltInUsernameSet, getDefaultUsersSeed } from '@/lib/defaultUsersConfig'
import { normalizeUsername, validateNewPassword, validateUsername } from '@/lib/accountValidation'

// ── Storage keys ──────────────────────────────────────────────────────────────

const USERS_KEY  = 'app_auth_users'
const SEEDED_KEY = 'app_auth_seeded'

// ── Internal stored-user shape ────────────────────────────────────────────────

interface StoredUser {
  id: string
  username: string
  id_number: string
  role: Role
  is_active: boolean
  /** When true, omitted from User Management (built-in / secret accounts). */
  hidden_from_management: boolean
  created_at: string
  last_login?: string
  password_hash: string   // hex PBKDF2 output
  password_salt: string   // hex random salt
}

// ── PBKDF2 helpers ────────────────────────────────────────────────────────────

function randomHex(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deriveKey(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256,
  )
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomHex(16)
  const hash = await deriveKey(password, salt)
  return { hash, salt }
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await deriveKey(password, salt)
  return derived === hash
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadUsers(): StoredUser[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[]
    return migrateStoredUsers(raw)
  } catch {
    return []
  }
}

function saveUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function migrateStoredUsers(users: StoredUser[]): StoredUser[] {
  let changed = false
  const next = users.map((u) => {
    const raw = u as StoredUser & Record<string, unknown>
    let newRole = migrateStoredRoleValue(raw.role)
    // Legacy seed: built-in `admin` was BYPASS; operational admin is ADMIN, BYPASS is a separate account (`vendor`).
    if (String(raw.username).toLowerCase() === 'admin' && newRole === 'BYPASS') {
      newRole = 'ADMIN'
    }
    const copy: StoredUser = {
      id: raw.id,
      username: raw.username,
      id_number: raw.id_number,
      role: newRole,
      is_active: raw.is_active,
      hidden_from_management: raw.hidden_from_management ?? getBuiltInUsernameSet().has(String(raw.username).toLowerCase()),
      created_at: raw.created_at,
      last_login: raw.last_login,
      password_hash: raw.password_hash,
      password_salt: raw.password_salt,
    }
    if (raw.hidden_from_management === undefined) changed = true
    if ('is_bypassed' in raw) changed = true
    if (raw.role !== newRole) changed = true
    return copy
  })
  // At most one BYPASS; demote duplicates to plain ADMIN
  let seenBypass = false
  for (let i = 0; i < next.length; i++) {
    if (next[i].role !== 'BYPASS') continue
    if (!seenBypass) {
      seenBypass = true
      continue
    }
    next[i] = { ...next[i], role: 'ADMIN' }
    changed = true
  }
  if (changed) saveUsers(next)
  return next
}

/** Active accounts with role ADMIN only (operational admins). */
function countActiveOperationalAdmins(users: StoredUser[]): number {
  return users.filter(u => u.is_active && u.role === 'ADMIN').length
}

function toPublicUser(s: StoredUser): User {
  return {
    id: s.id,
    username: s.username,
    id_number: s.id_number,
    role: s.role,
    is_active: s.is_active,
    created_at: s.created_at,
    last_login: s.last_login,
  }
}

// ── Initialisation ────────────────────────────────────────────────────────────

let initPromise: Promise<void> | null = null

/**
 * Seed default users if the store has never been initialised.
 * Call once at app startup (awaited before rendering routes).
 */
export async function initLocalAuth(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (localStorage.getItem(SEEDED_KEY)) return

    const now = new Date().toISOString()
    const seeded: StoredUser[] = []

    for (const s of getDefaultUsersSeed()) {
      const { hash, salt } = await hashPassword(s.password)
      seeded.push({
        id: s.id,
        username: s.username,
        id_number: s.id_number,
        role: s.role,
        is_active: s.is_active,
        hidden_from_management: s.hidden_from_management,
        created_at: now,
        password_hash: hash,
        password_salt: salt,
      })
    }

    saveUsers(seeded)
    localStorage.setItem(SEEDED_KEY, 'true')
  })()
  return initPromise
}

/**
 * Ensures every username from `config/default-users.json` exists (adds missing rows).
 * Run after `initLocalAuth()` so legacy stores pick up e.g. `vendor` after `admin` → ADMIN migration.
 */
export async function reconcileDefaultUsersFromConfig(): Promise<void> {
  const users = loadUsers()
  const seeds = getDefaultUsersSeed()
  const now = new Date().toISOString()
  let changed = false
  for (const s of seeds) {
    const exists = users.some(u => u.username.toLowerCase() === s.username.toLowerCase())
    if (exists) continue
    const { hash, salt } = await hashPassword(s.password)
    users.push({
      id: s.id,
      username: s.username,
      id_number: s.id_number,
      role: s.role,
      is_active: s.is_active,
      hidden_from_management: s.hidden_from_management,
      created_at: now,
      password_hash: hash,
      password_salt: salt,
    })
    changed = true
  }
  if (changed) saveUsers(users)
}

// ── Public API ────────────────────────────────────────────────────────────────

export const localAuth = {
  /** Validate credentials. Throws with a user-facing message on failure. */
  async authenticate(username: string, password: string): Promise<User> {
    const users = loadUsers()
    const stored = users.find(u => u.username.toLowerCase() === username.toLowerCase())
    if (!stored) throw new Error('Invalid credentials')
    if (!stored.is_active) throw new Error('Account is disabled')

    const ok = await verifyPassword(password, stored.password_hash, stored.password_salt)
    if (!ok) throw new Error('Invalid credentials')

    stored.last_login = new Date().toISOString()
    saveUsers(users)
    return toPublicUser(stored)
  },

  /**
   * Users shown in User Management (excludes built-in / secret accounts).
   */
  getUsers(): User[] {
    return loadUsers()
      .filter(u => !u.hidden_from_management)
      .map(toPublicUser)
  },

  /** Create a new user. Throws if username already exists. */
  async createUser(data: {
    username: string
    password: string
    role: Role
    id_number?: string
    is_active?: boolean
  }): Promise<User> {
    const users = loadUsers()
    if (data.role === 'BYPASS') {
      throw new Error('Bypass cannot be assigned. It is reserved for the built-in hidden account.')
    }
    const userErr = validateUsername(data.username)
    if (userErr) throw new Error(userErr)
    const passErr = validateNewPassword(data.password)
    if (passErr) throw new Error(passErr)
    const username = normalizeUsername(data.username)
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error(`Username "${username}" is already taken`)
    }
    const { hash, salt } = await hashPassword(data.password)
    const newUser: StoredUser = {
      id: String(Date.now()),
      username,
      id_number:     data.id_number ?? '',
      role:          data.role,
      is_active:     data.is_active ?? true,
      hidden_from_management: false,
      created_at:    new Date().toISOString(),
      password_hash: hash,
      password_salt: salt,
    }
    users.push(newUser)
    saveUsers(users)
    return toPublicUser(newUser)
  },

  /** Update a user's profile. Pass `password` to change the password. */
  async updateUser(
    id: string,
    updates: Partial<{ username: string; role: Role; id_number: string; is_active: boolean; password: string }>,
  ): Promise<User> {
    const users = loadUsers()
    const idx = users.findIndex(u => u.id === id)
    if (idx < 0) throw new Error('User not found')

    const beforeActiveOperationalAdmins = countActiveOperationalAdmins(users)

    const u = users[idx]
    if (u.hidden_from_management) {
      throw new Error('This account cannot be edited from User Management')
    }
    if (updates.role === 'BYPASS') {
      throw new Error('Bypass cannot be assigned. It is reserved for the built-in hidden account.')
    }
    if (updates.username !== undefined) {
      const userErr = validateUsername(updates.username)
      if (userErr) throw new Error(userErr)
      const nextName = normalizeUsername(updates.username)
      const conflict = users.find(x => x.username.toLowerCase() === nextName.toLowerCase() && x.id !== id)
      if (conflict) throw new Error(`Username "${nextName}" is already taken`)
      u.username = nextName
    }
    if (updates.password) {
      const passErr = validateNewPassword(updates.password)
      if (passErr) throw new Error(passErr)
    }
    if (updates.role       !== undefined) u.role       = updates.role
    if (updates.id_number  !== undefined) u.id_number  = updates.id_number
    if (updates.is_active  !== undefined) u.is_active  = updates.is_active
    if (updates.password) {
      const { hash, salt } = await hashPassword(updates.password)
      u.password_hash = hash
      u.password_salt = salt
    }

    const hypothetical = users.map(x => (x.id === id ? { ...u } : x))
    // ADMIN and BYPASS are different roles: break-glass does not replace customer Admin.
    if (
      beforeActiveOperationalAdmins > 0
      && countActiveOperationalAdmins(hypothetical) === 0
    ) {
      throw new Error(
        'At least one active Admin account is required. Bypass is a separate role and does not replace it.',
      )
    }

    saveUsers(users)
    return toPublicUser(u)
  },

  /**
   * Change password for the signed-in account. Verifies current password first.
   */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const users = loadUsers()
    const u = users.find(x => x.id === userId)
    if (!u) throw new Error('User not found')
    const ok = await verifyPassword(currentPassword, u.password_hash, u.password_salt)
    if (!ok) throw new Error('Current password is incorrect')
    const passErr = validateNewPassword(newPassword)
    if (passErr) throw new Error(passErr)
    const { hash, salt } = await hashPassword(newPassword)
    u.password_hash = hash
    u.password_salt = salt
    saveUsers(users)
  },

  /** Delete a user by id. The last admin cannot be removed. */
  deleteUser(id: string): void {
    const users = loadUsers()
    const target = users.find(u => u.id === id)
    if (!target) throw new Error('User not found')
    if (target.hidden_from_management) {
      throw new Error('This account cannot be removed from User Management')
    }
    if (target.role === 'ADMIN') {
      const otherAdmins = users.filter(u => u.role === 'ADMIN' && u.id !== id)
      if (otherAdmins.length === 0) {
        throw new Error('Cannot delete the last Admin account')
      }
    }
    if (target.role === 'BYPASS') {
      const otherBypass = users.filter(u => u.role === 'BYPASS' && u.id !== id)
      if (otherBypass.length === 0) {
        throw new Error('Cannot delete the last Bypass account')
      }
    }
    saveUsers(users.filter(u => u.id !== id))
  },

  /** Reset the user store and re-seed defaults (use with caution). */
  async reset(): Promise<void> {
    localStorage.removeItem(USERS_KEY)
    localStorage.removeItem(SEEDED_KEY)
    initPromise = null
    await initLocalAuth()
  },
}
