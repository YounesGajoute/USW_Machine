import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Home,
  Settings,
  Book,
  Wrench,
  LogIn,
  LogOut,
  User,
  Crown,
  Shield,
  History,
  AlertTriangle,
  UserRound,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { Role } from '@/types/auth.types'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

const roleConfig: Record<
  Role,
  { gradient: string; shadow: string; icon: LucideIcon; badge?: LucideIcon }
> = {
  NONE: {
    gradient: 'linear-gradient(135deg, #9E9E9E 0%, #616161 100%)',
    shadow: '0 0 20px rgba(158, 158, 158, 0.6)',
    icon: User,
  },
  OPERATOR: {
    gradient: 'linear-gradient(135deg, #66BB6A 0%, #43A047 100%)',
    shadow: '0 0 20px rgba(76, 175, 80, 0.6)',
    icon: User,
  },
  QUALITY: {
    gradient: 'linear-gradient(135deg, #42A5F5 0%, #1E88E5 100%)',
    shadow: '0 0 20px rgba(33, 150, 243, 0.6)',
    icon: Shield,
  },
  MAINTENANCE: {
    gradient: 'linear-gradient(135deg, #FFB74D 0%, #FF9800 100%)',
    shadow: '0 0 20px rgba(255, 152, 0, 0.6)',
    icon: Wrench,
  },
  ADMIN: {
    gradient: 'linear-gradient(135deg, #EF5350 0%, #E53935 100%)',
    shadow: '0 0 25px rgba(244, 67, 54, 0.8)',
    icon: User,
    badge: Crown,
  },
  BYPASS: {
    gradient: 'linear-gradient(135deg, #7C4DFF 0%, #5E35B1 100%)',
    shadow: '0 0 28px rgba(94, 53, 177, 0.85)',
    icon: User,
    badge: Crown,
  },
}

function navTouchHandlers(navigate: (p: string) => void, path: string, disabled: boolean) {
  let touchStartTime = 0
  let touchStartPos = { x: 0, y: 0 }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      touchStartTime = Date.now()
      if (e.touches[0]) {
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      e.stopPropagation()
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const touchDuration = Date.now() - touchStartTime
      const touch = e.changedTouches[0]
      if (touch) {
        const deltaX = Math.abs(touch.clientX - touchStartPos.x)
        const deltaY = Math.abs(touch.clientY - touchStartPos.y)
        const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
        if (touchDuration < 300 && totalMovement < 10 && !disabled) {
          e.stopPropagation()
          navigate(path)
        }
      }
    },
    onTouchCancel: (e: React.TouchEvent) => e.stopPropagation(),
  }
}

function loginTouchHandlers(onLogin: () => void) {
  let touchStartTime = 0
  let touchStartPos = { x: 0, y: 0 }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      touchStartTime = Date.now()
      if (e.touches[0]) {
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      e.stopPropagation()
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const touchDuration = Date.now() - touchStartTime
      const touch = e.changedTouches[0]
      if (touch) {
        const deltaX = Math.abs(touch.clientX - touchStartPos.x)
        const deltaY = Math.abs(touch.clientY - touchStartPos.y)
        const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
        if (touchDuration < 300 && totalMovement < 10) {
          e.stopPropagation()
          onLogin()
        }
      }
    },
    onTouchCancel: (e: React.TouchEvent) => e.stopPropagation(),
  }
}

function logoutTouchHandlers(onLogout: () => void) {
  let touchStartTime = 0
  let touchStartPos = { x: 0, y: 0 }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      touchStartTime = Date.now()
      if (e.touches[0]) {
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      e.stopPropagation()
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const touchDuration = Date.now() - touchStartTime
      const touch = e.changedTouches[0]
      if (touch) {
        const deltaX = Math.abs(touch.clientX - touchStartPos.x)
        const deltaY = Math.abs(touch.clientY - touchStartPos.y)
        const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
        if (touchDuration < 300 && totalMovement < 10) {
          e.stopPropagation()
          onLogout()
        }
      }
    },
    onTouchCancel: (e: React.TouchEvent) => e.stopPropagation(),
  }
}

export interface HeaderProps {
  navItems: NavItem[]
  /** When true, nav buttons are dimmed and inactive (matches test-running behavior). */
  lockNavigation?: boolean
  user: {
    username: string
    id_number?: string
    role: Role
  } | null
  /** Always wired from the main shell — opens `#/login` (kiosk: never hide sign-in). */
  onLogin: () => void
  onLogout?: () => void
  logoSrc?: string
}

/**
 * 160px bar, logo, 100×100 nav tiles, user + logout (same chrome as legacy `Header.tsx`).
 */
export function Header({
  navItems,
  lockNavigation = false,
  user,
  onLogin,
  onLogout,
  logoSrc = '/logo.png',
}: HeaderProps) {
  const { colors } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [hoveredButton, setHoveredButton] = useState<string | null>(null)

  const isLoginActive = location.pathname === '/login'

  return (
    <header
      style={{
        height: '160px',
        backgroundColor: colors.primary,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 50px',
        position: 'relative',
        zIndex: 1000,
        touchAction: 'manipulation',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <img
          src={logoSrc}
          alt="Logo"
          style={{ height: '110px', width: 'auto', objectFit: 'contain' }}
          onError={(e) => {
            const el = e.currentTarget
            el.style.display = 'none'
            const next = el.nextElementSibling as HTMLElement | null
            if (next) next.style.display = 'flex'
          }}
        />
        <div
          style={{
            display: 'none',
            height: '110px',
            width: '160px',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.15)',
            borderRadius: '12px',
            color: 'white',
            fontWeight: 800,
            fontSize: '22px',
            letterSpacing: '0.06em',
          }}
        >
          LOGO
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', position: 'relative', zIndex: 1001, pointerEvents: 'auto' }}>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path
          const isHovered = hoveredButton === item.path
          const isDisabled = lockNavigation
          return (
            <button
              key={item.path}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!isDisabled) navigate(item.path)
              }}
              {...navTouchHandlers(navigate, item.path, isDisabled)}
              title={isDisabled ? 'Navigation locked' : item.label}
              onMouseEnter={() => !isDisabled && setHoveredButton(item.path)}
              onMouseLeave={() => setHoveredButton(null)}
              disabled={isDisabled}
              style={{
                width: '100px',
                height: '100px',
                background: isDisabled
                  ? '#666666'
                  : isActive
                    ? `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 48%, ${colors.primaryDark} 100%)`
                    : isHovered
                      ? colors.primaryDark
                      : colors.primaryDarker,
                color: isDisabled ? '#999999' : 'white',
                border: isActive ? '4px solid rgba(255, 255, 255, 1)' : '2px solid white',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isDisabled
                  ? 'scale(1)'
                  : isActive
                    ? 'scale(1.1)'
                    : isHovered
                      ? 'scale(1.06)'
                      : 'scale(1)',
                padding: 0,
                margin: 0,
                opacity: isDisabled ? 0.6 : 1,
                position: 'relative',
                zIndex: isActive ? 1002 : 1001,
                pointerEvents: 'auto',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
                userSelect: 'none',
                boxShadow: isActive
                  ? '0 6px 24px rgba(0, 178, 227, 0.7), 0 0 30px rgba(255, 255, 255, 0.5), 0 0 40px rgba(0, 178, 227, 0.4), inset 0 2px 8px rgba(255, 255, 255, 0.3), inset 0 -2px 8px rgba(0, 0, 0, 0.1)'
                  : isHovered
                    ? '0 4px 12px rgba(0, 178, 227, 0.4), 0 0 16px rgba(255, 255, 255, 0.2)'
                    : '0 2px 8px rgba(0, 0, 0, 0.2)',
                overflow: 'hidden',
              }}
            >
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '-100%',
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)',
                    animation: 'shine 3s infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}
              <Icon
                size={isActive ? 52 : 50}
                strokeWidth={isActive ? 3.5 : 2.5}
                style={{
                  filter: isActive
                    ? 'drop-shadow(0 3px 8px rgba(255, 255, 255, 0.8)) drop-shadow(0 0 12px rgba(0, 178, 227, 0.6))'
                    : 'none',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative',
                  zIndex: 1,
                }}
              />
              {isActive && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-6px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '70%',
                      height: '5px',
                      background: 'linear-gradient(90deg, transparent, white, transparent)',
                      borderRadius: '3px',
                      boxShadow:
                        '0 3px 12px rgba(255, 255, 255, 0.9), 0 0 20px rgba(0, 178, 227, 1), 0 0 30px rgba(0, 178, 227, 0.6)',
                      zIndex: 1003,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: '-6px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '70%',
                      height: '5px',
                      background: 'linear-gradient(90deg, transparent, white, transparent)',
                      borderRadius: '3px',
                      boxShadow:
                        '0 3px 12px rgba(255, 255, 255, 0.9), 0 0 20px rgba(0, 178, 227, 1), 0 0 30px rgba(0, 178, 227, 0.6)',
                      zIndex: 1003,
                    }}
                  />
                </>
              )}
            </button>
          )
        })}

        {/* Login tile — shown in nav only when not signed in (NONE role) */}
        {!user && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onLogin()
            }}
            {...loginTouchHandlers(onLogin)}
            title="Log in"
            aria-label="Log in"
            onMouseEnter={() => setHoveredButton('login-nav')}
            onMouseLeave={() => setHoveredButton(null)}
            style={{
              width: '100px',
              height: '100px',
              background: isLoginActive
                ? `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 48%, ${colors.primaryDark} 100%)`
                : hoveredButton === 'login-nav'
                  ? colors.primaryDark
                  : colors.primaryDarker,
              color: 'white',
              border: isLoginActive ? '4px solid rgba(255,255,255,1)' : '2px solid white',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: isLoginActive ? 'scale(1.1)' : hoveredButton === 'login-nav' ? 'scale(1.06)' : 'scale(1)',
              padding: '8px 0 6px',
              margin: 0,
              position: 'relative',
              zIndex: isLoginActive ? 1002 : 1001,
              pointerEvents: 'auto',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
              userSelect: 'none',
              boxShadow: isLoginActive
                ? '0 6px 24px rgba(0,178,227,0.7), 0 0 30px rgba(255,255,255,0.5), inset 0 2px 8px rgba(255,255,255,0.3)'
                : hoveredButton === 'login-nav'
                  ? '0 4px 12px rgba(0,178,227,0.4), 0 0 16px rgba(255,255,255,0.2)'
                  : '0 2px 8px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            {isLoginActive && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '-100%',
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                  animation: 'shine 3s infinite',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Composed icon: user circle + arrow-in badge */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Outer glow ring when active */}
              {isLoginActive && (
                <div style={{
                  position: 'absolute',
                  inset: '-6px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }} />
              )}
              {/* User avatar circle */}
              <div style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                background: isLoginActive
                  ? 'rgba(255,255,255,0.25)'
                  : 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                boxShadow: isLoginActive ? '0 0 12px rgba(255,255,255,0.5)' : 'none',
              }}>
                <UserRound
                  size={26}
                  strokeWidth={2.2}
                  color="white"
                  style={{
                    filter: isLoginActive ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' : 'none',
                  }}
                />
              </div>
              {/* Arrow-in badge — bottom-right of avatar */}
              <div style={{
                position: 'absolute',
                bottom: '-3px',
                right: '-6px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.85) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1.5px solid rgba(255,255,255,0.6)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              }}>
                <LogIn
                  size={11}
                  strokeWidth={3}
                  color={colors.primary}
                />
              </div>
            </div>

            {/* Label */}
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'white',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textShadow: isLoginActive ? '0 1px 4px rgba(0,0,0,0.4)' : '0 1px 2px rgba(0,0,0,0.3)',
              position: 'relative',
              zIndex: 1,
              lineHeight: 1,
            }}>
              Login
            </span>

            {/* Active state top/bottom accent bars */}
            {isLoginActive && (
              <>
                <div style={{ position: 'absolute', bottom: '-6px', left: '50%', transform: 'translateX(-50%)', width: '70%', height: '5px', background: 'linear-gradient(90deg, transparent, white, transparent)', borderRadius: '3px', boxShadow: '0 3px 12px rgba(255,255,255,0.9), 0 0 20px rgba(0,178,227,1)', zIndex: 1003 }} />
                <div style={{ position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)', width: '70%', height: '5px', background: 'linear-gradient(90deg, transparent, white, transparent)', borderRadius: '3px', boxShadow: '0 3px 12px rgba(255,255,255,0.9), 0 0 20px rgba(0,178,227,1)', zIndex: 1003 }} />
              </>
            )}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        {/* User info — always shown; `user` is null when role is NONE (not signed in) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {(() => {
            const role = user?.role ?? 'NONE'
            const config = roleConfig[role] ?? roleConfig.NONE
            const IconComponent = config.icon
            return (
              <div
                onMouseEnter={() => setHoveredButton('user-avatar')}
                onMouseLeave={() => setHoveredButton(null)}
                style={{
                  width: '70px',
                  height: '70px',
                  borderRadius: '50%',
                  background: config.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '3px solid white',
                  boxShadow: `${config.shadow}, inset 0 2px 8px rgba(255,255,255,0.3), inset 0 -2px 8px rgba(0,0,0,0.2)`,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative',
                  transform: hoveredButton === 'user-avatar' ? 'scale(1.15) rotate(5deg)' : 'scale(1) rotate(0deg)',
                }}
              >
                <IconComponent
                  size={38}
                  strokeWidth={2.8}
                  color="white"
                  style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))', zIndex: 1 }}
                />
                {config.badge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #FFD700 0%, #FFA000 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid white',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      zIndex: 2,
                    }}
                  >
                    <Crown size={15} strokeWidth={2.5} color="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
                  </div>
                )}
              </div>
            )
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ color: 'white', fontSize: '24px', fontFamily: 'Arial, sans-serif', fontWeight: '600', textShadow: '0 2px 6px rgba(0,0,0,0.4)', letterSpacing: '0.3px' }}>
              {user?.username ?? 'NONE'}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '18px', fontFamily: 'Arial, sans-serif', fontWeight: '400', textShadow: '0 1px 3px rgba(0,0,0,0.3)', fontStyle: 'italic' }}>
              {user ? (user.id_number ?? '—') : 'NONE'}
            </span>
          </div>
        </div>

        {user && onLogout && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onLogout()
            }}
            {...logoutTouchHandlers(onLogout)}
            title="Logout"
            aria-label="Log out"
            onMouseEnter={() => setHoveredButton('logout')}
            onMouseLeave={() => setHoveredButton(null)}
            style={{
              width: '100px',
              height: '100px',
              backgroundColor: hoveredButton === 'logout' ? colors.primaryDark : colors.primaryDarker,
              color: 'white',
              border: '2px solid white',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: hoveredButton === 'logout' ? 'scale(1.05)' : 'scale(1)',
              position: 'relative',
              zIndex: 1001,
              pointerEvents: 'auto',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
              userSelect: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            <LogOut size={50} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </header>
  )
}

export const defaultNavItems: NavItem[] = [
  { path: '/', label: 'Main', icon: Home },
  { path: '/references', label: 'References', icon: Book },
  { path: '/history', label: 'History', icon: History },
  { path: '/error-history', label: 'Errors', icon: AlertTriangle },
  { path: '/settings', label: 'Settings', icon: Settings },
]
