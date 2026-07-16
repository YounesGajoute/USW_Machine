/**
 * Structured Settings API errors.
 */

export class SettingsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, details?: unknown }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message)
    this.name = 'SettingsError'
    this.code = code
    this.status = opts.status ?? 400
    this.details = opts.details ?? null
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

export function settingsErrorResponse(err) {
  if (err instanceof SettingsError) {
    return {
      status: err.status,
      body: { status: 'error', error: err.toJSON() },
    }
  }
  return {
    status: 500,
    body: {
      status: 'error',
      error: { code: 'INTERNAL', message: err?.message || 'Internal settings error', details: null },
    },
  }
}
