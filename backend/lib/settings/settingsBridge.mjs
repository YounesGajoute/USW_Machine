/**
 * Breaks circular imports between SettingsService and config stores.
 * initSettingsService() registers the singleton here; stores read it optionally.
 */

/** @type {ReturnType<import('./service.mjs').createSettingsService>|null} */
let _service = null

export function setSettingsServiceRef(service) {
  _service = service
}

export function tryGetSettingsService() {
  return _service
}
