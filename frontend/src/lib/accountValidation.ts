/**
 * Shared rules for user accounts (User Management + API).
 * Remote APIs may enforce stricter policy server-side.
 */

export const USERNAME_MIN_LEN = 2
export const USERNAME_MAX_LEN = 64
export const PASSWORD_MIN_LEN = 8
export const PASSWORD_MAX_LEN = 128

/** Letters, digits, dot, underscore, hyphen, @ — no whitespace or control chars. */
const USERNAME_RE = /^[a-zA-Z0-9._@-]+$/

export type UsernameIssue = 'empty' | 'too_short' | 'too_long' | 'invalid_chars'
export type PasswordIssue = 'too_short' | 'too_long'

export function normalizeUsername(raw: string): string {
  return raw.trim()
}

/** Returns null if the username is acceptable (after trim). */
export function checkUsername(raw: string): UsernameIssue | null {
  const u = normalizeUsername(raw)
  if (u.length === 0) return 'empty'
  if (u.length < USERNAME_MIN_LEN) return 'too_short'
  if (u.length > USERNAME_MAX_LEN) return 'too_long'
  if (!USERNAME_RE.test(u)) return 'invalid_chars'
  return null
}

/** Human-readable English messages (fallback when i18n is not used). */
export function validateUsername(raw: string): string | null {
  const issue = checkUsername(raw)
  if (!issue) return null
  const messages: Record<UsernameIssue, string> = {
    empty: 'Username is required',
    too_short: `Username must be at least ${USERNAME_MIN_LEN} characters`,
    too_long: `Username must be at most ${USERNAME_MAX_LEN} characters`,
    invalid_chars: 'Username may only contain letters, numbers, and . _ - @',
  }
  return messages[issue]
}

/** Non-empty password strength for create / change. */
export function checkNewPassword(password: string): PasswordIssue | null {
  if (password.length > PASSWORD_MAX_LEN) return 'too_long'
  if (password.length < PASSWORD_MIN_LEN) return 'too_short'
  return null
}

export function validateNewPassword(password: string): string | null {
  const issue = checkNewPassword(password)
  if (!issue) return null
  const messages: Record<PasswordIssue, string> = {
    too_short: `Password must be at least ${PASSWORD_MIN_LEN} characters`,
    too_long: `Password must be at most ${PASSWORD_MAX_LEN} characters`,
  }
  return messages[issue]
}
