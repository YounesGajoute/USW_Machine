import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppLocale } from '@/i18n/generalSettings'
import { getGeneralCopy, readStoredLocale, loadLocaleFromApi, writeStoredLocale } from '@/i18n/generalSettings'
import { getUserManagementCopy } from '@/i18n/userManagement'

interface LocaleContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  general: ReturnType<typeof getGeneralCopy>
  userMgmt: ReturnType<typeof getUserManagementCopy>
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale())

  // Load persisted locale from the API on mount.
  useEffect(() => {
    loadLocaleFromApi().then(l => {
      setLocaleState(l)
    }).catch(() => {})
  }, [])

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next)
    writeStoredLocale(next).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'fr' ? 'fr' : 'en'
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      general: getGeneralCopy(locale),
      userMgmt: getUserManagementCopy(locale),
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
