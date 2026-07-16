/**
 * Central SQLite settings bootstrap — one API call on app launch hydrates all caches.
 */
import type { SystemSettings, TestMode } from '@/types/settings.types'
import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings } from '@/lib/settingsCacheState'
import { normalizeAppTheme } from '@/lib/themePalettes'

let bootstrapPromise: Promise<SystemSettings> | null = null

/** Keys omitted from the unauthenticated GET /api/settings/system subset. */
const AUTH_ONLY_SETTING_KEYS = [
  'serial_number',
  'quickpass',
  'post_update_action',
  'history_retention_days',
  'role_tab_access',
  'reference_serial',
  'vision_url',
  'vision_remote_key',
  'vision_local_key',
] as const

/**
 * Motion / vision keys that may be present in an authenticated cache but omitted
 * from a tightened public GET. Preserve from prev when absent in the new payload
 * so settingsUpdated re-bootstrap does not blank open admin session caches.
 */
const MOTION_OR_FULL_KEYS = [
  'pick_place_config',
  'production_sequence_config',
  'centring_config',
  'centring_frame_config',
  'centering_input_start_mm',
  'centering_input_offset_mm',
  'mechanism_positions_by_machine',
  'vision_general_tool_template',
  'vision_url',
] as const

function normalizeTestMode(v: unknown): TestMode {
  if (v === 'manual' || v === 'reference' || v === 'sequential') return v
  return 'manual'
}

function normalizeSettings(stored: Record<string, unknown>): SystemSettings {
  const theme = normalizeAppTheme(stored.theme) ?? undefined
  const locale = stored.locale === 'en' || stored.locale === 'fr' ? stored.locale : undefined
  const machine_model =
    stored.machine_model === 'STCS-CS19' || stored.machine_model === 'STCS-evo500'
      ? stored.machine_model
      : undefined
  return {
    ...stored,
    ...(theme ? { theme } : {}),
    ...(locale ? { locale } : {}),
    ...(machine_model ? { machine_model } : {}),
    test_mode: normalizeTestMode(stored.test_mode),
  } as SystemSettings
}

/**
 * When an unauthenticated (subset) GET arrives after a fuller cache existed,
 * keep auth-only and motion keys so settingsUpdated re-bootstrap does not wipe them.
 * Only preserves from prev when the key is absent in the raw response — never invents values.
 */
function mergePreservingAuthOnly(
  prev: SystemSettings | null,
  next: SystemSettings,
  rawKeys: string[],
): SystemSettings {
  if (!prev) return next
  const raw = new Set(rawKeys)
  const out: SystemSettings = { ...next }
  const preserve = new Set<string>([...AUTH_ONLY_SETTING_KEYS, ...MOTION_OR_FULL_KEYS])
  for (const key of preserve) {
    if (!raw.has(key) && key in prev) {
      ;(out as Record<string, unknown>)[key] = (prev as Record<string, unknown>)[key]
    }
  }
  return out
}

/**
 * Load all system settings from SQLite via the API and hydrate every dependent cache.
 * Safe to call multiple times; concurrent calls share one in-flight request.
 */
export async function bootstrapSettingsFromApi(force = false): Promise<SystemSettings> {
  if (!force && getCachedSystemSettings()) return getCachedSystemSettings()!
  if (!force && bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    const res = await apiFetch('/api/settings/system')
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText)
      throw new Error(msg || `HTTP ${res.status}`)
    }
    const data = (await res.json()) as { settings?: Record<string, unknown> }
    const raw = data.settings ?? {}
    const rawKeys = Object.keys(raw)
    const normalized = normalizeSettings(raw)
    const settings = mergePreservingAuthOnly(getCachedSystemSettings(), normalized, rawKeys)
    setCachedSystemSettings(settings)
    return settings
  })()

  try {
    return await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

/** Listen for settingsUpdated events and refresh the cache from the API. */
export function attachSettingsBootstrapListener(): () => void {
  const onUpdated = () => {
    void bootstrapSettingsFromApi(true).catch(() => {})
  }
  window.addEventListener('settingsUpdated', onUpdated)
  return () => window.removeEventListener('settingsUpdated', onUpdated)
}

export { getCachedSystemSettings, setCachedSystemSettings } from '@/lib/settingsCacheState'
