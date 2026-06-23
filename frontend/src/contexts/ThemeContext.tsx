import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { themePalettes, type AppTheme, type ThemePalette } from '@/lib/themePalettes'
import { applyThemeCssVariables } from '@/lib/themeCssVars'
import { readStoredTheme, loadThemeFromApi, writeStoredTheme } from '@/lib/themeStorage'

interface ThemeContextValue {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  colors: ThemePalette
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme())

  // Load persisted theme from the API on mount.
  useEffect(() => {
    loadThemeFromApi().then(t => {
      setThemeState(t)
    }).catch(() => {})
  }, [])

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next)
    writeStoredTheme(next).catch(() => {})
  }, [])

  const colors = themePalettes[theme]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    applyThemeCssVariables(colors)
    const root = document.getElementById('root')
    const bg = colors.background
    const fg = colors.text
    document.documentElement.style.backgroundColor = bg
    document.body.style.backgroundColor = bg
    document.body.style.color = fg
    if (root) {
      root.style.backgroundColor = bg
    }
  }, [theme, colors])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      colors,
    }),
    [theme, setTheme, colors],
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
