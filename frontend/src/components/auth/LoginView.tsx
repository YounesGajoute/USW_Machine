import { useState, useRef, useEffect, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, User, Lock, LogIn, AlertCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useRequireLogin } from '@/hooks/useRequireLogin'
import VirtualKeyboard from './VirtualKeyboard'
import { useTheme } from '@/contexts/ThemeContext'
const MAX_USERNAME_LENGTH = 100
const MAX_PASSWORD_LENGTH = 255


export default function LoginView() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [activeField, setActiveField] = useState<'username' | 'password' | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const blurTimeoutRef = useRef<number | null>(null)
  const submitAttemptRef = useRef<number>(0)

  const { login, isAuthenticated, user } = useAuth()
  const { loading: requireLoginLoading } = useRequireLogin()
  const navigate = useNavigate()
  const { colors } = useTheme()

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) clearTimeout(blurTimeoutRef.current)
    }
  }, [])

  const submitLogin = useCallback(async () => {
    if (isSubmitting || isLoading) return

    const trimmedUsername = username.trim()
    const trimmedPassword = password.trim()

    if (!trimmedUsername) {
      setError('Username is required')
      setActiveField('username')
      setTimeout(() => usernameRef.current?.focus(), 0)
      return
    }
    if (!trimmedPassword) {
      setError('Password is required')
      setActiveField('password')
      setTimeout(() => passwordRef.current?.focus(), 0)
      return
    }

    setError(null)
    setIsLoading(true)
    setIsSubmitting(true)
    submitAttemptRef.current += 1
    const currentAttempt = submitAttemptRef.current

    try {
      await login({ username: trimmedUsername, password: trimmedPassword })
      if (currentAttempt !== submitAttemptRef.current) return
      setUsername('')
      setPassword('')
      navigate('/', { replace: true })
    } catch (err) {
      if (currentAttempt !== submitAttemptRef.current) return
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Invalid credentials'
      setError(message)
      setPassword('')
      setActiveField('username')
      setTimeout(() => { usernameRef.current?.focus(); usernameRef.current?.select() }, 0)
    } finally {
      if (currentAttempt === submitAttemptRef.current) {
        setIsLoading(false)
        setIsSubmitting(false)
      }
    }
  }, [username, password, login, navigate, isSubmitting, isLoading])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    await submitLogin()
  }, [submitLogin])

  const handleKeyPress = useCallback((key: string) => {
    if (isLoading) return
    if (activeField === 'username') setUsername(prev => prev.length < MAX_USERNAME_LENGTH ? prev + key : prev)
    else if (activeField === 'password') setPassword(prev => prev.length < MAX_PASSWORD_LENGTH ? prev + key : prev)
  }, [activeField, isLoading])

  const handleBackspace = useCallback(() => {
    if (isLoading) return
    if (activeField === 'username') setUsername(prev => prev.slice(0, -1))
    else if (activeField === 'password') setPassword(prev => prev.slice(0, -1))
  }, [activeField, isLoading])

  const handleClear = useCallback(() => {
    if (isLoading) return
    if (activeField === 'username') { setUsername(''); setError(null) }
    else if (activeField === 'password') { setPassword(''); setError(null) }
  }, [activeField, isLoading])

  const handleFieldFocus = useCallback((field: 'username' | 'password') => {
    setActiveField(field)
    setError(null)
  }, [])

  const handleFieldBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (blurTimeoutRef.current !== null) clearTimeout(blurTimeoutRef.current)
    const related = e.relatedTarget as HTMLElement
    if (related && (related.id === 'username' || related.id === 'password' || related.id === 'pw-toggle' || related.closest('.keyboard-container'))) return
    blurTimeoutRef.current = window.setTimeout(() => {
      if (document.activeElement?.id !== 'username' && document.activeElement?.id !== 'password') setActiveField(null)
    }, 300)
  }, [])

  const handleKeyboardEnter = useCallback(async () => {
    if (isLoading) return
    if (activeField === 'username') { passwordRef.current?.focus(); setActiveField('password') }
    else if (activeField === 'password') await submitLogin()
    else { usernameRef.current?.focus(); setActiveField('username') }
  }, [activeField, isLoading, submitLogin])

  const inputStyle = (active: boolean): React.CSSProperties => ({
    width: '100%',
    paddingLeft: '48px',
    paddingRight: '16px',
    paddingTop: '10px',
    paddingBottom: '10px',
    fontSize: '18px',
    borderRadius: '8px',
    border: `2px solid ${active ? colors.primary : colors.primary}40`,
    backgroundColor: colors.white,
    color: colors.text,
    transition: 'all 0.2s',
    boxShadow: active ? `0 0 0 3px ${colors.primary}20` : 'none',
    outline: 'none',
    minHeight: '42px',
    touchAction: 'manipulation',
  })

  if (requireLoginLoading) return null

  // Already signed in — go back to main
  if (isAuthenticated && user && user.role !== 'NONE') {
    return <Navigate to="/" replace />
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        overflow: 'hidden',
        backgroundColor: colors.background,
        touchAction: 'manipulation',
      }}
    >
        {/* Login card */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', flex: '0 0 auto' }}>
          <div style={{ width: '500px', backgroundColor: colors.white, borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: `2px solid ${colors.border}` }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h1 className="sr-only">Sign in</h1>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
                  boxShadow: '0 4px 12px rgba(0,178,227,0.3)',
                }}
                aria-hidden="true"
              >
                <Lock style={{ width: '30px', height: '30px', color: colors.white }} aria-hidden="true" />
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} noValidate>
              {/* Username */}
              <div>
                <label htmlFor="username" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '600', color: colors.text }}>Username</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: activeField === 'username' ? colors.primary : `${colors.primary}80`, pointerEvents: 'none' }}>
                    <User style={{ width: '20px', height: '20px' }} aria-hidden="true" />
                  </div>
                  <input
                    ref={usernameRef}
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => { if (e.target.value.length <= MAX_USERNAME_LENGTH) setUsername(e.target.value) }}
                    onFocus={() => handleFieldFocus('username')}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); passwordRef.current?.focus(); setActiveField('password') }
                      if (e.key === 'Escape') { setUsername(''); setError(null) }
                    }}
                    style={inputStyle(activeField === 'username')}
                    required
                    autoFocus
                    autoComplete="username"
                    inputMode="none"
                    placeholder="Enter username"
                    disabled={isLoading}
                    maxLength={MAX_USERNAME_LENGTH}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '600', color: colors.text }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: activeField === 'password' ? colors.primary : `${colors.primary}80`, pointerEvents: 'none' }}>
                    <Lock style={{ width: '20px', height: '20px' }} aria-hidden="true" />
                  </div>
                  <input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { if (e.target.value.length <= MAX_PASSWORD_LENGTH) setPassword(e.target.value) }}
                    onFocus={() => handleFieldFocus('password')}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); if (!isLoading && !isSubmitting) submitLogin() }
                      if (e.key === 'Escape') { setPassword(''); setError(null) }
                    }}
                    style={{ ...inputStyle(activeField === 'password'), paddingRight: '56px' }}
                    required
                    autoComplete="current-password"
                    inputMode="none"
                    placeholder="Enter password"
                    disabled={isLoading}
                    maxLength={MAX_PASSWORD_LENGTH}
                  />
                  <button
                    id="pw-toggle"
                    type="button"
                    onClick={() => { if (!isLoading) setShowPassword(p => !p) }}
                    onTouchEnd={(e) => { e.preventDefault(); if (!isLoading) setShowPassword(p => !p) }}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', padding: '8px', backgroundColor: 'transparent', border: 'none', borderRadius: '8px', cursor: isLoading ? 'not-allowed' : 'pointer', touchAction: 'manipulation', opacity: isLoading ? 0.5 : 1 }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff style={{ width: '20px', height: '20px', color: colors.textSecondary }} /> : <Eye style={{ width: '20px', height: '20px', color: colors.textSecondary }} />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div role="alert" aria-live="polite" style={{ backgroundColor: colors.errorBg, border: `2px solid ${colors.error}40`, color: colors.error, padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle style={{ width: '20px', height: '20px', flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontWeight: '500', fontSize: '14px' }}>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading || isSubmitting}
                onTouchEnd={(e) => { if (!isLoading && !isSubmitting) { e.preventDefault(); submitLogin() } }}
                style={{ width: '100%', padding: '12px 20px', fontSize: '18px', fontWeight: '600', color: colors.white, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, border: 'none', borderRadius: '8px', cursor: isLoading || isSubmitting ? 'not-allowed' : 'pointer', boxShadow: '0 4px 12px rgba(0,178,227,0.3)', opacity: isLoading || isSubmitting ? 0.5 : 1, touchAction: 'manipulation', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '42px' }}
                aria-busy={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg style={{ width: '20px', height: '20px', animation: 'login-spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <LogIn style={{ width: '20px', height: '20px' }} aria-hidden="true" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>


        {/* Virtual keyboard — fills remaining space; no nested scrollbars */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', touchAction: 'manipulation' }}>
          <VirtualKeyboard
            onKeyPress={handleKeyPress}
            onBackspace={handleBackspace}
            onClear={handleClear}
            onEnter={handleKeyboardEnter}
          />
        </div>

      <style>{`@keyframes login-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
