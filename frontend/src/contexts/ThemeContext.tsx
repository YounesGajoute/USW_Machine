import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isVersigentTheme, themePalettes, type AppTheme, type ThemePalette } from '@/lib/themePalettes'
import { applyThemeCssVariables } from '@/lib/themeCssVars'
import { applyLegacyDesignTokens, applyVersigentDesignTokens } from '@/lib/themeDesignTokens'
import { readStoredTheme, loadThemeFromApi, writeStoredTheme } from '@/lib/themeStorage'
import { getThemeCache } from '@/lib/settingsCacheState'

interface ThemeContextValue {
  theme: AppTheme
  setTheme: (theme: AppTheme) => Promise<void>
  colors: ThemePalette
  isVersigent: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme())

  useEffect(() => {
    let cancelled = false
    loadThemeFromApi()
      .then(t => {
        if (!cancelled) setThemeState(t)
      })
      .catch(() => {})

    const syncFromCache = () => {
      const cached = getThemeCache()
      if (cached) setThemeState(cached)
    }
    window.addEventListener('settingsUpdated', syncFromCache)
    return () => {
      cancelled = true
      window.removeEventListener('settingsUpdated', syncFromCache)
    }
  }, [])

  const setTheme = useCallback(async (next: AppTheme) => {
    const previous = theme
    setThemeState(next)
    try {
      await writeStoredTheme(next)
    } catch (err) {
      setThemeState(previous)
      throw err
    }
  }, [theme])

  const colors = themePalettes[theme]
  const isVersigent = isVersigentTheme(theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.brand = isVersigent ? 'versigent' : 'legacy'
    applyThemeCssVariables(colors)
    if (isVersigent) {
      applyVersigentDesignTokens(colors)
    } else {
      applyLegacyDesignTokens()
    }
    const root = document.getElementById('root')
    const bg = colors.background
    const fg = colors.text
    document.documentElement.style.backgroundColor = bg
    document.body.style.backgroundColor = bg
    document.body.style.color = fg
    if (root) {
      root.style.backgroundColor = bg
    }
  }, [theme, colors, isVersigent])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      colors,
      isVersigent,
    }),
    [theme, setTheme, colors, isVersigent],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function useThemeOptional() {
  return useContext(ThemeContext)
}
