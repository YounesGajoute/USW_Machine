/** Presence of an HMI Settings page. Only an explicit exit releases the gate. */
const settingsOwners = new Set()

function validToken(token) {
  return typeof token === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(token)
}

export function setSettingsPagePresence(token, active) {
  if (!validToken(token)) throw Object.assign(new Error('A Settings page token is required'), { status: 400 })
  if (active === true) settingsOwners.add(token)
  else if (active === false) settingsOwners.delete(token)
  else throw Object.assign(new Error('Settings page active must be true or false'), { status: 400 })
  return isSettingsPageActive()
}

export function isSettingsPageActive() {
  return settingsOwners.size > 0
}

export function resetSettingsPagePresence() {
  settingsOwners.clear()
}
