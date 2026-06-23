import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Shell } from '@/components/Shell'
import { MainPage } from '@/components/MainPage'
import { useMachineModel } from '@/hooks/useMachineModel'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { RequireLoginProvider } from '@/hooks/useRequireLogin'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import LoginView from '@/components/auth/LoginView'
import HistoryPage from '@/pages/HistoryPage'
import ErrorHistoryPage from '@/pages/ErrorHistoryPage'
import ReferencesPage from '@/pages/ReferencesPage'
import SettingsPage from '@/pages/SettingsPage'
import type { Role } from '@/types/auth.types'
import { TabGuardRoute } from '@/components/routing/TabGuardRoute'
import { defaultNavItems } from '@/components/Header'
import { TabAccessProvider, useAccessibleTabKeys, hasTabAccess } from '@/hooks/useAccessibleTabKeys'
import { ActiveReferenceProvider } from '@/contexts/ActiveReferenceContext'
import { SettingsBootstrapProvider } from '@/contexts/SettingsBootstrapContext'
import { ROUTE_PATH_TO_TAB } from '@/lib/roleTabAccess'
import { initKioskTouchScrollRoot } from '@/lib/kioskTouchScroll'
import { useRequireLogin } from '@/hooks/useRequireLogin'

/**
 * Holds rendering until auth + settings are resolved.
 * Per-tab access (including /login redirect for NONE) is handled by TabGuardRoute.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading } = useAuth()
  const { loading: requireLoading } = useRequireLogin()

  if (authLoading || requireLoading) return null

  return <>{children}</>
}

/**
 * Same pattern as legacy `App.tsx`: `<Header />` and page are siblings; shell
 * uses `height: calc(100vh - 160px)` for the content column.
 */
function AppLayout() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { tabs: accessTabs, loading: accessTabsLoading } = useAccessibleTabKeys()

  const navItems = useMemo(() => {
    if (accessTabsLoading) return []
    return defaultNavItems.filter(nav => {
      const tabKey = ROUTE_PATH_TO_TAB[nav.path]
      if (!tabKey) return true
      return hasTabAccess(accessTabs, tabKey, user?.role)
    })
  }, [accessTabs, accessTabsLoading, user?.role])

  const authUser = user
    ? { username: user.username, id_number: user.id_number, role: user.role as Role }
    : null

  return (
    <>
      <Header
        navItems={navItems}
        lockNavigation={false}
        user={authUser}
        onLogin={() => navigate('/login')}
        onLogout={logout}
      />
      <Shell>
        <Outlet />
      </Shell>
    </>
  )
}

function MainPageWithModel() {
  const { imageSrc, model } = useMachineModel()
  return (
    <MainPage
      modeImageSrc={imageSrc ?? undefined}
      modeImageAlt={model ?? undefined}
    />
  )
}

function AppShell() {
  const { colors } = useTheme()

  useEffect(() => {
    document.documentElement.classList.add('app-ready')
    document.body.classList.add('app-ready')
  }, [])

  useEffect(() => {
    return initKioskTouchScrollRoot()
  }, [])

  // Session lifetime is managed by the server-side cookie (7-day maxAge).
  // No client-side cleanup needed on unload.

  return (
    <div
      className="min-h-screen"
      style={{
        touchAction: 'auto',
        pointerEvents: 'auto',
        WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
        backgroundColor: colors.background,
        color: colors.text,
      }}
    >
      <Routes>
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/login" element={<LoginView />} />
          <Route index element={<TabGuardRoute tabKey="main"><MainPageWithModel /></TabGuardRoute>} />
          <Route path="references" element={<TabGuardRoute tabKey="reference"><ReferencesPage /></TabGuardRoute>} />
          <Route path="history" element={<TabGuardRoute tabKey="history"><HistoryPage /></TabGuardRoute>} />
          <Route path="error-history" element={<TabGuardRoute tabKey="error-history"><ErrorHistoryPage /></TabGuardRoute>} />
          <Route path="settings" element={<TabGuardRoute tabKey="settings"><SettingsPage /></TabGuardRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <SettingsBootstrapProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <LocaleProvider>
              <AuthProvider>
                <RequireLoginProvider>
                  <TabAccessProvider>
                    <ActiveReferenceProvider>
                      <AppShell />
                    </ActiveReferenceProvider>
                  </TabAccessProvider>
                </RequireLoginProvider>
              </AuthProvider>
            </LocaleProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </SettingsBootstrapProvider>
    </HashRouter>
  )
}
