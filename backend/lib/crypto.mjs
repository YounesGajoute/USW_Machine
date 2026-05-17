/**
 * PBKDF2-SHA-256 (10_000 × 32 bytes) for password hashing.
 */
import crypto from 'node:crypto'

export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex')
}

export function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex')
  return crypto.pbkdf2Sync(password, salt, 10_000, 32, 'sha256').toString('hex')
}

export function hashPassword(password) {
  const salt = randomHex(16)
  const hash = deriveKey(password, salt)
  return { hash, salt }
}

export function verifyPassword(password, hashHex, saltHex) {
  return deriveKey(password, saltHex) === hashHex
}
