import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppLocale } from '@/i18n/generalSettings'
import { getGeneralCopy, readStoredLocale, loadLocaleFromApi, writeStoredLocale } from '@/i18n/generalSettings'
import { getUserManagementCopy } from '@/i18n/userManagement'
import { getProductionSequenceCopy } from '@/i18n/productionSequenceSettings'
import { getLocaleCache } from '@/lib/settingsCacheState'

interface LocaleContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => Promise<void>
  general: ReturnType<typeof getGeneralCopy>
  userMgmt: ReturnType<typeof getUserManagementCopy>
  productionSequence: ReturnType<typeof getProductionSequenceCopy>
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale())

  useEffect(() => {
    let cancelled = false
    loadLocaleFromApi()
      .then(l => {
        if (!cancelled) setLocaleState(l)
      })
      .catch(() => {})

    const syncFromCache = () => {
      const cached = getLocaleCache()
      if (cached) setLocaleState(cached)
    }
    window.addEventListener('settingsUpdated', syncFromCache)
    return () => {
      cancelled = true
      window.removeEventListener('settingsUpdated', syncFromCache)
    }
  }, [])

  const setLocale = useCallback(async (next: AppLocale) => {
    const previous = locale
    setLocaleState(next)
    try {
      await writeStoredLocale(next)
    } catch (err) {
      setLocaleState(previous)
      throw err
    }
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale === 'fr' ? 'fr' : 'en'
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      general: getGeneralCopy(locale),
      userMgmt: getUserManagementCopy(locale),
      productionSequence: getProductionSequenceCopy(locale),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

/** Returns `null` when used outside `LocaleProvider` (safe for optional i18n). */
export function useLocaleOptional() {
  return useContext(LocaleContext)
}
