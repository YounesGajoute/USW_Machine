import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Shell } from '@/components/Shell'
import { MainPage } from '@/components/MainPage'
import { useMachineModel } from '@/hooks/useMachineModel'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { RequireLoginProvider } from '@/hooks/useRequireLogin'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { VersigentCopperLines } from '@/components/versigent/VersigentCopperLines'
import LoginView from '@/components/auth/LoginView'
import HistoryPage from '@/pages/HistoryPage'
import ErrorHistoryPage from '@/pages/ErrorHistoryPage'
import ReferencesPage from '@/pages/ReferencesPage'
import SettingsPage from '@/pages/SettingsPage'
import type { Role } from '@/types/auth.types'
import { TabGuardRoute } from '@/components/routing/TabGuardRoute'
import { SessionWatcher } from '@/components/routing/SessionWatcher'
import { defaultNavItems } from '@/components/Header'
import { TabAccessProvider, useAccessibleTabKeys, hasTabAccess } from '@/hooks/useAccessibleTabKeys'
import { ActiveReferenceProvider } from '@/contexts/ActiveReferenceContext'
import { ProductionCountsProvider } from '@/contexts/ProductionCountsContext'
import { SettingsBootstrapProvider } from '@/contexts/SettingsBootstrapContext'
import { PageFeedbackProvider, usePageFeedback } from '@/contexts/PageFeedbackContext'
import { PageFeedbackBar } from '@/components/PageFeedbackBar'
import { ROUTE_PATH_TO_TAB } from '@/lib/roleTabAccess'
import { initKioskTouchScrollRoot } from '@/lib/kioskTouchScroll'
import { FullHdStage } from '@/components/FullHdStage'
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
 * Header and page share the 1920×1080 stage. The shell fills the space under the 160px header.
 */
function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { tabs: accessTabs, loading: accessTabsLoading } = useAccessibleTabKeys()

  const isMainPage = location.pathname === '/' || location.pathname === ''
  const isLoginPage = location.pathname === '/login'
  const showPageFeedbackBar = !isMainPage && !isLoginPage
  const { clear: clearPageFeedback } = usePageFeedback()

  useEffect(() => {
    clearPageFeedback()
  }, [location.pathname, clearPageFeedback])

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <Header
        navItems={navItems}
        lockNavigation={false}
        user={authUser}
        onLogin={() => navigate('/login', { state: { from: location.pathname + location.search } })}
        onLogout={logout}
      />
      <Shell>
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Outlet />
          </div>
          {showPageFeedbackBar ? <PageFeedbackBar /> : null}
        </div>
      </Shell>
    </div>
  )
}

function MainPageWithModel() {
  const { imageSrc, model } = useMachineModel()
  return (
    <MainPage
      modeImageSrc={imageSrc ?? undefined}
      modeImageAlt={model ?? undefined}
      modelName={model ?? undefined}
    />
  )
}

function AppShell() {
  const { colors, isVersigent } = useTheme()

  useEffect(() => {
    document.documentElement.classList.add('app-ready')
    document.body.classList.add('app-ready')
  }, [])

  useEffect(() => {
    return initKioskTouchScrollRoot()
  }, [])

  // Chromium stores zoom/layout per host. Force loopback IP → localhost so the
  // HDMI kiosk always uses the same well-sized origin as http://localhost:5173.
  useEffect(() => {
    const { hostname, protocol, port, pathname, search, hash } = window.location
    if (hostname !== '127.0.0.1' && hostname !== '[::1]') return
    const next = new URL(`${protocol}//localhost${port ? `:${port}` : ''}${pathname}${search}${hash}`)
    window.location.replace(next.href)
  }, [])

  // Session lifetime is owned by the server (persistent SQLite store + rolling
  // cookie). The client keeps the signed-in identity until explicit logout
  // (or a confirmed dead session). SessionWatcher only routes to /login when
  // that confirmation fires.

  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === '127.0.0.1' || h === '[::1]') {
      return null
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{
        touchAction: 'auto',
        pointerEvents: 'auto',
        WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
        backgroundColor: colors.background,
        color: colors.text,
        position: 'relative',
      }}
    >
      {isVersigent && <VersigentCopperLines copper={colors.brandCopper} variant="page" />}
      <SessionWatcher />
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
          <Route path="settings/:sectionId?" element={<TabGuardRoute tabKey="settings"><SettingsPage /></TabGuardRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <FullHdStage>
    <HashRouter>
      <SettingsBootstrapProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <LocaleProvider>
              <AuthProvider>
                <RequireLoginProvider>
                  <TabAccessProvider>
                    <ActiveReferenceProvider>
                      <ProductionCountsProvider>
                        <PageFeedbackProvider>
                          <AppShell />
                        </PageFeedbackProvider>
                      </ProductionCountsProvider>
                    </ActiveReferenceProvider>
                  </TabAccessProvider>
                </RequireLoginProvider>
              </AuthProvider>
            </LocaleProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </SettingsBootstrapProvider>
    </HashRouter>
    </FullHdStage>
  )
}
