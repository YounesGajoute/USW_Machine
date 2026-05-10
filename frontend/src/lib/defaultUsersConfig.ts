import type { Role } from '@/types/auth.types'
import { migrateStoredRoleValue } from '@/lib/legacyRoleNames'
import raw from '../../config/default-users.json'

export interface DefaultUserFileEntry {
  id?: string
  username: string
  password: string
  role: string
  id_number?: string
  /** When false, account cannot sign in. Default true. */
  is_active?: boolean
  /** When true (default), user is hidden from Settings → User Management for customers. */
  hidden_from_customer?: boolean
  /** When false, row is omitted from local-login credential hints. Default true. */
  show_on_login_hints?: boolean
  /** Short label on login hints (e.g. vendor bypass). */
  login_hint_note?: string
}

interface DefaultUsersFile {
  version: number
  users: DefaultUserFileEntry[]
}

const data = raw as DefaultUsersFile

function parseSeeds(): Array<{
  id: string
  username: string
  password: string
  role: Role
  id_number: string
  is_active: boolean
  hidden_from_management: boolean
  show_on_login_hints: boolean
  login_hint_note: string
}> {
  if (!Array.isArray(data.users) || data.users.length === 0) {
    throw new Error('config/default-users.json: "users" must be a non-empty array')
  }
  const seen = new Set<string>()
  return data.users.map((u, i) => {
    const username = typeof u.username === 'string' ? u.username.trim() : ''
    if (!username) throw new Error(`config/default-users.json: user[${i}] missing username`)
    const key = username.toLowerCase()
    if (seen.has(key)) throw new Error(`config/default-users.json: duplicate username "${username}"`)
    seen.add(key)
    const password = typeof u.password === 'string' ? u.password : ''
    if (!password) throw new Error(`config/default-users.json: user "${username}" missing password`)
    const role = migrateStoredRoleValue(u.role) as Role
    if (role === 'NONE') throw new Error(`config/default-users.json: user "${username}" has invalid role`)
    const id = typeof u.id === 'string' && u.id.trim() ? u.id.trim() : String(i + 1)
    return {
      id,
      username,
      password,
      role,
      id_number: typeof u.id_number === 'string' ? u.id_number : '',
      is_active: u.is_active !== false,
      hidden_from_management: u.hidden_from_customer !== false,
      show_on_login_hints: u.show_on_login_hints !== false,
      login_hint_note: typeof u.login_hint_note === 'string' ? u.login_hint_note : '',
    }
  })
}

let cached: ReturnType<typeof parseSeeds> | null = null

/** Built-in accounts for first-time seed (localStorage + server). */
export function getDefaultUsersSeed(): ReadonlyArray<{
  id: string
  username: string
  password: string
  role: Role
  id_number: string
  is_active: boolean
  hidden_from_management: boolean
  show_on_login_hints: boolean
  login_hint_note: string
}> {
  if (!cached) cached = parseSeeds()
  return cached
}

/** Usernames treated as built-in when repairing `hidden_from_management` on old stores. */
export function getBuiltInUsernameSet(): Set<string> {
  return new Set(getDefaultUsersSeed().map(u => u.username.toLowerCase()))
}

/** Rows for the local-auth login hint panel (respects `show_on_login_hints`). */
export function getLoginHintRows(): Array<{
  username: string
  password: string
  role: string
  note: string
}> {
  return getDefaultUsersSeed()
    .filter(u => u.show_on_login_hints)
    .map(u => ({
      username: u.username,
      password: u.password,
      role: u.role,
      note: u.login_hint_note,
    }))
}
