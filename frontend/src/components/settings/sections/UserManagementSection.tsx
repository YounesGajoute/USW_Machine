import { useState, useMemo, useCallback, useEffect } from 'react'
import type React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Filter,
  User as UserIcon,
  Shield,
  Lock,
  X,
  Save,
  RotateCcw,
  Home,
  Settings,
  Book,
  Wrench,
  UserCircle,
  Clock,
  Gauge,
  Activity,
  History,
  Download,
  Printer,
  AlertTriangle,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_DLG_COMPACT_W, KIOSK_DLG_CONFIRM_W, KIOSK_DLG_FORM_W, KIOSK_DLG_MAX_H, KIOSK_DLG_MAX_H_TALL } from '@/lib/kioskDialogSizing'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { Dialog, DialogContent, DialogScrollArea, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import DialogVirtualKeyboard from '@/components/auth/DialogVirtualKeyboard'
import { Switch } from '@/components/ui/Switch'
import type { User, Role } from '@/types/auth.types'
import { hasMinRole, isBypassRole } from '@/types/auth.types'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/contexts/LocaleContext'
import { checkNewPassword, checkUsername } from '@/lib/accountValidation'
import { passwordIssueMessage, usernameIssueMessage } from '@/i18n/userManagement'
import { useAccessibleTabKeys, hasTabAccess } from '@/hooks/useAccessibleTabKeys'
import {
  ignoresTabAccessGates,
  sortRoleEntries,
  type RoleTabAccessRow,
} from '@/lib/roleTabAccess'
import {
  loadFullRoleTabAccess,
  saveRoleTabAccessForRole,
  changeOwnPassword,
} from '@/services/roleTabAccessService'


export interface UserFormData {
  username: string
  password?: string
  role: Role
  id_number?: string
  is_active: boolean
}

export interface UserManagementSectionProps {
  users: User[]
  loading?: boolean
  error?: string | null
  onCreate?: (data: UserFormData) => Promise<void>
  onUpdate?: (id: string, data: Partial<UserFormData>) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}

const ROLES: Role[] = ['OPERATOR', 'QUALITY', 'MAINTENANCE', 'ADMIN']

const ROLE_COLORS: Record<Role, { bg: string; border: string; text: string }> = {
  ADMIN: { bg: '#E3F2FD', border: '#1976D2', text: '#1565C0' },
  BYPASS: { bg: '#FCE4EC', border: '#C2185B', text: '#880E4F' },
  MAINTENANCE: { bg: '#FFF3E0', border: '#F57C00', text: '#E65100' },
  QUALITY: { bg: '#F3E5F5', border: '#7B1FA2', text: '#6A1B9A' },
  OPERATOR: { bg: '#E8F5E9', border: '#388E3C', text: '#2E7D32' },
  NONE: { bg: '#F5F5F5', border: '#9E9E9E', text: '#757575' },
}

const TAB_ICONS: Partial<Record<string, LucideIcon>> = {
  login: UserCircle,
  main: Home,
  settings: Settings,
  calibration: Wrench,
  reference: Book,
  history: Clock,
  'error-history': AlertTriangle,
  settings_general: Settings,
  settings_chambers: Gauge,
  settings_users: UserIcon,
  settings_my_account: UserIcon,
  settings_diagnostics: Activity,
  settings_history: History,
  settings_export: Download,
  settings_labels: Printer,
}

type DialogMode = 'create' | 'edit' | null
type KbField = 'username' | 'password' | 'confirmPassword' | 'id_number' | null
type MgmtTab = 'my-account' | 'accounts' | 'tab-access'
type SortField = 'username' | 'role' | 'status' | 'last_login' | 'created_at'
type SortOrder = 'asc' | 'desc'

function formatUserDate(iso: string | undefined, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(locale === 'fr' ? 'fr-FR' : undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function sanitizeIdDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
        {label}
        {required && <span style={{ color: colors.error, marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

export function UserManagementSection({
  users,
  loading = false,
  error,
  onCreate,
  onUpdate,
  onDelete,
}: UserManagementSectionProps) {
  const { colors } = useTheme()
  const inputStyle = useMemo(
    () =>
      ({
        width: '100%',
        padding: '10px 14px',
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        fontSize: '16px',
        color: colors.text,
        backgroundColor: colors.white,
        boxSizing: 'border-box' as const,
        outline: 'none',
      }) satisfies React.CSSProperties,
    [colors],
  )
  const { user: sessionUser } = useAuth()
  const { locale, userMgmt: t } = useLocale()
  const { tabs: accessTabs, loading: accessTabsLoading } = useAccessibleTabKeys()

  const gateTab = useCallback(
    (key: string) => {
      if (ignoresTabAccessGates(sessionUser?.role)) return true
      if (accessTabsLoading) return true
      return hasTabAccess(accessTabs, key, sessionUser?.role)
    },
    [accessTabs, accessTabsLoading, sessionUser?.role],
  )

  const canMyAccount = gateTab('settings_my_account')
  const canUserAccounts = gateTab('settings_users')
  /** ADMIN and BYPASS (rank ≥ ADMIN) get the full tab-access matrix editor. */
  const showTabAccessEditor = hasMinRole(sessionUser, 'ADMIN')
  /** Only Bypass (vendor) may change which tabs the operational Admin role may use. */
  const bypassCanEditAdminTabAccess = isBypassRole(sessionUser)

  const [activeTab, setActiveTab] = useState<MgmtTab>('my-account')

  useEffect(() => {
    if (activeTab === 'my-account' && !canMyAccount && canUserAccounts) setActiveTab('accounts')
    else if (activeTab === 'accounts' && !canUserAccounts && canMyAccount) setActiveTab('my-account')
    else if (activeTab === 'tab-access' && !showTabAccessEditor) {
      if (canMyAccount) setActiveTab('my-account')
      else if (canUserAccounts) setActiveTab('accounts')
    }
  }, [activeTab, canMyAccount, canUserAccounts, showTabAccessEditor])

  // ── My Account: change password ────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState<string | null>(null)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwKb, setPwKb] = useState<'current' | 'new' | 'confirm' | null>(null)

  const submitPasswordChange = useCallback(async () => {
    setPwErr(null)
    if (!pwCurrent || !pwNew) {
      setPwErr(t.validation.passwordShort)
      return
    }
    const pIssue = checkNewPassword(pwNew)
    if (pIssue) {
      setPwErr(passwordIssueMessage(t.validation, pIssue))
      return
    }
    if (pwNew !== pwConfirm) {
      setPwErr(t.passwordsMismatch)
      return
    }
    try {
      setPwSaving(true)
      await changeOwnPassword(pwCurrent, pwNew)
      setPwOk(t.passwordChanged)
      setPwCurrent('')
      setPwNew('')
      setPwConfirm('')
      setPwOpen(false)
      setPwKb(null)
      setTimeout(() => setPwOk(null), 4000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : t.passwordChangeFailed
      setPwErr(msg.includes('incorrect') ? t.currentPasswordWrong : msg)
    } finally {
      setPwSaving(false)
    }
  }, [pwConfirm, pwCurrent, pwNew, t])

  // ── Accounts list filters / sort ───────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('username')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const filteredUsers = useMemo(() => {
    let list = [...users]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        u =>
          u.username.toLowerCase().includes(q)
          || u.role.toLowerCase().includes(q)
          || (u.id_number && u.id_number.toLowerCase().includes(q)),
      )
    }
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter)
    if (statusFilter !== 'all') {
      list = list.filter(u => (statusFilter === 'active' ? u.is_active : !u.is_active))
    }
    list.sort((a, b) => {
      let aV: string | number = 0
      let bV: string | number = 0
      switch (sortField) {
        case 'username':
          aV = a.username.toLowerCase()
          bV = b.username.toLowerCase()
          break
        case 'role':
          aV = a.role
          bV = b.role
          break
        case 'status':
          aV = a.is_active ? 1 : 0
          bV = b.is_active ? 1 : 0
          break
        case 'last_login':
          aV = a.last_login ? new Date(a.last_login).getTime() : 0
          bV = b.last_login ? new Date(b.last_login).getTime() : 0
          break
        case 'created_at':
          aV = a.created_at ? new Date(a.created_at).getTime() : 0
          bV = b.created_at ? new Date(b.created_at).getTime() : 0
          break
      }
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [users, search, roleFilter, statusFilter, sortField, sortOrder])

  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter(u => u.is_active).length
    return { total, active, inactive: total - active }
  }, [users])

  const toggleActiveRow = async (u: User) => {
    if (!onUpdate) return
    if (sessionUser?.id === u.id) return
    try {
      setTogglingId(u.id)
      await onUpdate(u.id, { is_active: !u.is_active })
    } catch {
      /* parent surfaces */
    } finally {
      setTogglingId(null)
    }
  }

  // ── Create / edit dialog (accounts) ─────────────────────────────────────────
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormData>({ username: '', password: '', role: 'OPERATOR', id_number: '', is_active: true })
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [kbTarget, setKbTarget] = useState<KbField>(null)

  const roleLabel = useCallback((r: Role) => t.roles[r] ?? r, [t.roles])
  const bypassReadOnly = editingUser?.role === 'BYPASS'

  const openCreate = () => {
    setForm({ username: '', password: '', role: 'OPERATOR', id_number: '', is_active: true })
    setConfirmPassword('')
    setActionError(null)
    setDialogMode('create')
  }

  const openEdit = (u: User) => {
    setEditingUser(u)
    setForm({
      username: u.username,
      password: '',
      role: u.role,
      id_number: u.id_number ?? '',
      is_active: u.is_active,
    })
    setConfirmPassword('')
    setActionError(null)
    setDialogMode('edit')
  }

  const closeDialog = () => {
    setDialogMode(null)
    setEditingUser(null)
    setKbTarget(null)
    setConfirmPassword('')
  }

  const handleSave = useCallback(async () => {
    const idDigits = form.id_number?.trim() ?? ''
    if (idDigits && !/^\d+$/.test(idDigits)) {
      setActionError(t.idNumberDigitsOnly)
      return
    }
    const uIssue = checkUsername(form.username)
    if (uIssue) {
      setActionError(usernameIssueMessage(t.validation, uIssue))
      return
    }
    if (dialogMode === 'create') {
      const pIssue = checkNewPassword(form.password ?? '')
      if (pIssue) {
        setActionError(passwordIssueMessage(t.validation, pIssue))
        return
      }
      if ((form.password ?? '') !== confirmPassword) {
        setActionError(t.passwordsMismatch)
        return
      }
    } else if (editingUser && form.password) {
      const pIssue = checkNewPassword(form.password)
      if (pIssue) {
        setActionError(passwordIssueMessage(t.validation, pIssue))
        return
      }
      if (form.password !== confirmPassword) {
        setActionError(t.passwordsMismatch)
        return
      }
    }

    if (dialogMode === 'edit' && editingUser && sessionUser?.id === editingUser.id && !form.is_active) {
      setActionError(t.cannotDeactivateSelf)
      return
    }

    try {
      setSaving(true)
      setActionError(null)
      if (dialogMode === 'create') {
        await onCreate?.({ ...form, id_number: idDigits || undefined })
      } else if (editingUser) {
        const updates: Partial<UserFormData> = {
          username: form.username.trim(),
          is_active: form.is_active,
          id_number: idDigits,
        }
        if (!bypassReadOnly) updates.role = form.role
        if (form.password) updates.password = form.password
        await onUpdate?.(editingUser.id, updates)
      }
      closeDialog()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t.loadFailed)
    } finally {
      setSaving(false)
    }
  }, [
    bypassReadOnly,
    confirmPassword,
    dialogMode,
    editingUser,
    form,
    onCreate,
    onUpdate,
    sessionUser?.id,
    t,
  ])

  const handleDelete = async () => {
    if (!deleteTarget) return
    if (sessionUser?.id === deleteTarget.id) {
      setActionError(t.cannotDeleteSelf)
      return
    }
    try {
      setDeleting(true)
      await onDelete?.(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t.loadFailed)
    } finally {
      setDeleting(false)
    }
  }

  const kbAppend = (ch: string) => {
    if (!kbTarget) return
    if (kbTarget === 'confirmPassword') {
      setConfirmPassword(p => p + ch)
      return
    }
    if (kbTarget === 'id_number') {
      if (!/^\d$/.test(ch)) return
      setForm(f => ({ ...f, id_number: sanitizeIdDigits((f.id_number ?? '') + ch) }))
      return
    }
    setForm(f => ({ ...f, [kbTarget]: ((f[kbTarget] as string) ?? '') + ch }))
  }
  const kbBackspace = () => {
    if (!kbTarget) return
    if (kbTarget === 'confirmPassword') {
      setConfirmPassword(p => p.slice(0, -1))
      return
    }
    setForm(f => ({ ...f, [kbTarget]: ((f[kbTarget] as string) ?? '').slice(0, -1) }))
  }
  const kbClear = () => {
    if (!kbTarget) return
    if (kbTarget === 'confirmPassword') {
      setConfirmPassword('')
      return
    }
    if (kbTarget === 'id_number') {
      setForm(f => ({ ...f, id_number: '' }))
      return
    }
    setForm(f => ({ ...f, [kbTarget]: '' }))
  }

  const numericKb = kbTarget === 'id_number'

  // ── Tab access editor ──────────────────────────────────────────────────────
  const [roleMap, setRoleMap] = useState<Record<string, RoleTabAccessRow>>({})
  const [roleMapOrig, setRoleMapOrig] = useState<Record<string, RoleTabAccessRow>>({})
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [permErr, setPermErr] = useState<string | null>(null)
  const [permOk, setPermOk] = useState<string | null>(null)

  const loadPermissions = useCallback(async () => {
    try {
      setPermLoading(true)
      setPermErr(null)
      const data = await loadFullRoleTabAccess()
      setRoleMap(JSON.parse(JSON.stringify(data)))
      setRoleMapOrig(JSON.parse(JSON.stringify(data)))
    } catch (e) {
      setPermErr(e instanceof Error ? e.message : t.tabAccessSaveFailed)
    } finally {
      setPermLoading(false)
    }
  }, [t.tabAccessSaveFailed])

  useEffect(() => {
    if (activeTab === 'tab-access' && showTabAccessEditor) void loadPermissions()
  }, [activeTab, showTabAccessEditor, loadPermissions])

  const permDirty = useMemo(() => JSON.stringify(roleMap) !== JSON.stringify(roleMapOrig), [roleMap, roleMapOrig])

  const toggleRoleTab = (role: string, tab: string) => {
    if (role === 'ADMIN' && !bypassCanEditAdminTabAccess) return
    // NONE must always keep 'login' so the login page is always reachable.
    if (role === 'NONE' && tab === 'login') return
    setRoleMap(prev => {
      const row = prev[role]
      if (!row) return prev
      const has = row.tabs.includes(tab)
      const nextTabs = has ? row.tabs.filter(x => x !== tab) : [...row.tabs, tab]
      return { ...prev, [role]: { ...row, tabs: nextTabs } }
    })
  }

  const savePermissions = async () => {
    try {
      setPermSaving(true)
      setPermErr(null)
      setPermOk(null)
      const roles = Object.keys(roleMap).filter(r => r !== 'ADMIN' || bypassCanEditAdminTabAccess)
      for (const role of roles) {
        const cur = roleMap[role]?.tabs ?? []
        const orig = roleMapOrig[role]?.tabs ?? []
        const a = [...cur].sort().join(',')
        const b = [...orig].sort().join(',')
        if (a !== b) await saveRoleTabAccessForRole(role, cur)
      }
      await loadPermissions()
      setPermOk(t.tabAccessSaved)
      setTimeout(() => setPermOk(null), 5000)
    } catch (e) {
      setPermErr(e instanceof Error ? e.message : t.tabAccessSaveFailed)
      await loadPermissions()
    } finally {
      setPermSaving(false)
    }
  }

  const resetPermissions = () => {
    setRoleMap(JSON.parse(JSON.stringify(roleMapOrig)))
    setPermErr(null)
    setPermOk(null)
  }

  const tabLabel = (id: string) => {
    const labels = t.accessTabLabels as Record<string, string>
    return labels[id] ?? id.replace(/_/g, ' ')
  }

  const subTabs = useMemo(() => {
    const list: { id: MgmtTab; label: string; icon: LucideIcon }[] = []
    if (canMyAccount) list.push({ id: 'my-account', label: t.tabMyAccount, icon: UserIcon })
    if (canUserAccounts) list.push({ id: 'accounts', label: t.tabUserAccounts, icon: Shield })
    if (showTabAccessEditor) list.push({ id: 'tab-access', label: t.tabTabAccess, icon: Lock })
    return list
  }, [canMyAccount, canUserAccounts, showTabAccessEditor, t])

  return (
    <div style={{ padding: 0, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: colors.text, display: 'flex', alignItems: 'center', gap: '12px', margin: 0, letterSpacing: '-0.02em' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: `${colors.primary}1A`,
            }}
          >
            <UserIcon size={24} color={colors.primaryDark} strokeWidth={2.25} />
          </span>
          {t.title}
        </h2>
      </div>

      {subTabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t.title}
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            gap: '4px',
            marginBottom: '16px',
            padding: '5px',
            borderRadius: '12px',
            backgroundColor: colors.grey,
            border: `1px solid ${colors.border}`,
          }}
        >
          {subTabs.map(tab => {
            const Icon = tab.icon
            const on = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  backgroundColor: on ? colors.white : 'transparent',
                  color: on ? colors.primaryDark : colors.textSecondary,
                  fontWeight: on ? 600 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '15px',
                  boxShadow: on ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <Icon size={18} strokeWidth={2.25} />
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {activeTab === 'my-account' && sessionUser && (
        <div>
          {pwOk && (
            <div style={{ backgroundColor: '#DFF0D8', color: colors.success, padding: '12px', borderRadius: '8px', marginBottom: '16px', border: `1px solid ${colors.success}` }}>
              {pwOk}
            </div>
          )}
          <div style={{ backgroundColor: colors.white, borderRadius: '10px', padding: '18px', border: `1px solid ${colors.border}`, width: '100%', maxWidth: '100%' }}>
            <h3 style={{ marginTop: 0, color: colors.text }}>{t.myAccountDetails}</h3>
            <div style={{ marginBottom: '12px', color: colors.textSecondary }}>{t.username}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: colors.text, marginBottom: '16px' }}>{sessionUser.username}</div>
            <div style={{ marginBottom: '12px', color: colors.textSecondary }}>{t.idNumber}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: colors.text, marginBottom: '16px' }}>{sessionUser.id_number || '—'}</div>
            <div style={{ marginBottom: '12px', color: colors.textSecondary }}>{t.role}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: colors.text, marginBottom: '20px' }}>{roleLabel(sessionUser.role)}</div>
            <button
              type="button"
              onClick={() => {
                setPwErr(null)
                setPwCurrent('')
                setPwNew('')
                setPwConfirm('')
                setPwOpen(true)
              }}
              style={{
                padding: '10px 20px',
                backgroundColor: colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Lock size={18} />
              {t.changePassword}
            </button>
          </div>

          <Dialog open={pwOpen} onOpenChange={o => { if (!o) { setPwOpen(false); setPwKb(null) } }}>
            <DialogContent noScrollWrap style={{ width: KIOSK_DLG_COMPACT_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
              <DialogScrollArea>
                <DialogHeader>
                  <DialogTitle>{t.changePassword}</DialogTitle>
                  <DialogDescription>{t.changePasswordIntro}</DialogDescription>
                </DialogHeader>
                {pwErr && (
                  <div role="alert" style={{ backgroundColor: '#F2DEDE', color: colors.error, padding: '10px', borderRadius: '6px', marginBottom: '12px' }}>{pwErr}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <FormField label={t.currentPassword} required>
                    <input
                      type="password"
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      onFocus={() => setPwKb('current')}
                      style={inputStyle}
                      autoComplete="current-password"
                    />
                  </FormField>
                  <FormField label={t.newPasswordField} required>
                    <input
                      type="password"
                      value={pwNew}
                      onChange={e => setPwNew(e.target.value)}
                      onFocus={() => setPwKb('new')}
                      style={inputStyle}
                      autoComplete="new-password"
                    />
                  </FormField>
                  <FormField label={t.confirmNewPassword} required>
                    <input
                      type="password"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      onFocus={() => setPwKb('confirm')}
                      style={inputStyle}
                      autoComplete="new-password"
                    />
                  </FormField>
                </div>
              </DialogScrollArea>
              {pwKb && (
                <DialogVirtualKeyboard
                  onKeyPress={ch => {
                    if (pwKb === 'current') setPwCurrent(x => x + ch)
                    if (pwKb === 'new') setPwNew(x => x + ch)
                    if (pwKb === 'confirm') setPwConfirm(x => x + ch)
                  }}
                  onBackspace={() => {
                    if (pwKb === 'current') setPwCurrent(x => x.slice(0, -1))
                    if (pwKb === 'new') setPwNew(x => x.slice(0, -1))
                    if (pwKb === 'confirm') setPwConfirm(x => x.slice(0, -1))
                  }}
                  onClear={() => {
                    if (pwKb === 'current') setPwCurrent('')
                    if (pwKb === 'new') setPwNew('')
                    if (pwKb === 'confirm') setPwConfirm('')
                  }}
                  onEnter={() => void submitPasswordChange()}
                  onClose={() => setPwKb(null)}
                />
              )}
              <DialogFooter>
                <button type="button" onClick={() => setPwOpen(false)} style={{ padding: '10px 18px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.grey, cursor: 'pointer', fontSize: '15px' }}>{t.cancel}</button>
                <button type="button" disabled={pwSaving} onClick={() => void submitPasswordChange()} style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: colors.primary, color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>{pwSaving ? t.saving : t.save}</button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeTab === 'accounts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '20px', color: colors.text }}>{t.tabUserAccounts}</h3>
            {onCreate && (
              <button
                type="button"
                onClick={openCreate}
                style={{
                  padding: '10px 20px',
                  backgroundColor: colors.success,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Plus size={18} /> {t.newUser}
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            {[
              { label: t.statTotal, value: stats.total, color: colors.text },
              { label: t.statActive, value: stats.active, color: colors.success },
              { label: t.statInactive, value: stats.inactive, color: colors.error },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '14px', border: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: '14px', color: colors.textSecondary }}>{s.label}</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ backgroundColor: '#F2DEDE', color: colors.error, padding: '12px', borderRadius: '6px', marginBottom: '16px', border: `1px solid ${colors.error}` }}>{error}</div>
          )}

          <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '14px', border: `1px solid ${colors.border}`, marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 600, color: colors.text }}>
                  <Search size={14} /> {t.filterSearch}
                </label>
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t.searchPlaceholder} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 600, color: colors.text }}>
                  <Filter size={14} /> {t.filterRole}
                </label>
                <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={inputStyle}>
                  <option value="all">{t.allRoles}</option>
                  {ROLES.map(r => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: colors.text }}>{t.filterStatus}</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
                  <option value="all">{t.allStatuses}</option>
                  <option value="active">{t.active}</option>
                  <option value="inactive">{t.inactive}</option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: colors.textSecondary }}>{t.loading}</div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: colors.textSecondary }}>{t.noUsers}</div>
          ) : (
            <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '10px', border: `1px solid ${colors.border}`, overflow: 'auto', ...touchScrollable }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
                    {(
                      [
                        ['username', t.colUsername],
                        ['role', t.colRole],
                        ['status', t.colStatus],
                        ['last_login', t.colLastLogin],
                        ['created_at', t.colCreated],
                      ] as const
                    ).map(([field, label]) => (
                      <th key={field} style={{ textAlign: 'left', padding: '12px', cursor: 'pointer', color: colors.text, fontSize: '14px' }} onClick={() => handleSort(field)}>
                        {label}
                        {sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                    <th style={{ textAlign: 'left', padding: '12px', color: colors.text, fontSize: '14px' }}>{t.colIdNumber}</th>
                    <th style={{ textAlign: 'right', padding: '12px', color: colors.text, fontSize: '14px' }}>{t.edit}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const rc = ROLE_COLORS[u.role] ?? ROLE_COLORS.NONE
                    const isSelf = sessionUser?.id === u.id
                    return (
                      <tr key={u.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '12px', fontWeight: 600, color: colors.text }}>
                          {u.username}
                          {isSelf && (
                            <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', backgroundColor: colors.statusBg, color: colors.statusText, border: `1px solid ${colors.statusBorder}` }}>{t.you}</span>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ padding: '4px 10px', borderRadius: '16px', backgroundColor: rc.bg, border: `1px solid ${rc.border}`, color: rc.text, fontSize: '13px', fontWeight: 'bold' }}>{roleLabel(u.role)}</span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          {onUpdate && (
                            <Switch
                              checked={u.is_active}
                              onChange={() => void toggleActiveRow(u)}
                              disabled={isSelf || togglingId === u.id}
                              label={u.is_active ? t.active : t.inactive}
                            />
                          )}
                          {!onUpdate && (u.is_active ? t.active : t.inactive)}
                        </td>
                        <td style={{ padding: '12px', color: colors.textSecondary, fontSize: '14px' }}>{formatUserDate(u.last_login, locale) ?? '—'}</td>
                        <td style={{ padding: '12px', color: colors.textSecondary, fontSize: '14px' }}>{formatUserDate(u.created_at, locale) ?? '—'}</td>
                        <td style={{ padding: '12px', color: colors.textSecondary }}>{u.id_number || '—'}</td>
                        <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {onUpdate && (
                            <button type="button" onClick={() => openEdit(u)} style={{ padding: '8px 12px', marginRight: '8px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                              <Edit2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                              {t.edit}
                            </button>
                          )}
                          {onDelete && !isSelf && (
                            <button type="button" onClick={() => setDeleteTarget(u)} style={{ padding: '8px 12px', backgroundColor: colors.error, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                              <Trash2 size={14} style={{ verticalAlign: 'middle' }} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ padding: '10px 12px', textAlign: 'right', color: colors.textSecondary, fontSize: '13px' }}>{t.showingUsers(filteredUsers.length, users.length)}</div>
            </div>
          )}

          <Dialog open={dialogMode !== null} onOpenChange={open => { if (!open) closeDialog() }}>
            <DialogContent noScrollWrap style={{ width: KIOSK_DLG_FORM_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H_TALL }}>
              <DialogScrollArea>
                <DialogHeader>
                  <DialogTitle>{dialogMode === 'create' ? t.createTitle : t.editTitle}</DialogTitle>
                  <DialogDescription>
                    {dialogMode === 'create' ? t.createDescription : `${t.editDescription} ${editingUser?.username}`}
                  </DialogDescription>
                </DialogHeader>
                {actionError && (
                  <div role="alert" style={{ backgroundColor: '#F2DEDE', color: colors.error, padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', border: `1px solid ${colors.error}` }}>{actionError}</div>
                )}
                {/* 2-column grid: username + id number, password + confirm */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                  <FormField label={t.username} required>
                    <input
                      value={form.username}
                      onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      onFocus={() => setKbTarget('username')}
                      style={inputStyle}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label={t.idNumber}>
                    <input
                      value={form.id_number ?? ''}
                      onChange={e => setForm(f => ({ ...f, id_number: sanitizeIdDigits(e.target.value) }))}
                      onFocus={() => setKbTarget('id_number')}
                      placeholder={t.idNumberOptionalHint}
                      inputMode="numeric"
                      style={inputStyle}
                    />
                  </FormField>
                  <FormField label={dialogMode === 'create' ? t.password : t.passwordNew} required={dialogMode === 'create'}>
                    <input
                      type="password"
                      value={form.password ?? ''}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      onFocus={() => setKbTarget('password')}
                      style={inputStyle}
                      autoComplete={dialogMode === 'create' ? 'new-password' : 'current-password'}
                    />
                  </FormField>
                  {(dialogMode === 'create' || (dialogMode === 'edit' && !!form.password)) ? (
                    <FormField label={t.passwordConfirm} required={dialogMode === 'create' || !!form.password}>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        onFocus={() => setKbTarget('confirmPassword')}
                        style={inputStyle}
                        autoComplete="new-password"
                      />
                    </FormField>
                  ) : <div />}
                </div>
                {/* Role + Active — full width below the grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px 20px', marginTop: '12px', alignItems: 'start' }}>
                  <FormField label={t.role}>
                    {bypassReadOnly ? (
                      <div>
                        <div style={{ display: 'inline-block', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', marginBottom: '8px', border: `2px solid ${ROLE_COLORS.BYPASS.border}`, backgroundColor: ROLE_COLORS.BYPASS.bg, color: ROLE_COLORS.BYPASS.text }}>{roleLabel('BYPASS')}</div>
                        <p style={{ margin: 0, fontSize: '14px', color: colors.textSecondary }}>{t.roleReadOnlyBypass}</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {ROLES.map(r => {
                          const rc = ROLE_COLORS[r]
                          const selected = form.role === r
                          return (
                            <button key={r} type="button" onClick={() => setForm(f => ({ ...f, role: r }))} style={{ padding: '8px 16px', borderRadius: '20px', border: `2px solid ${selected ? rc.border : colors.border}`, backgroundColor: selected ? rc.bg : 'transparent', color: selected ? rc.text : colors.text, cursor: 'pointer', fontWeight: selected ? 'bold' : 'normal' }}>
                              {roleLabel(r)}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </FormField>
                  <FormField label={t.activeLabel}>
                    <Switch checked={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} disabled={!!(bypassReadOnly || (dialogMode === 'edit' && editingUser && sessionUser?.id === editingUser.id))} label={form.is_active ? t.active : t.inactive} />
                  </FormField>
                </div>
              </DialogScrollArea>
              {kbTarget && (
                <DialogVirtualKeyboard onKeyPress={kbAppend} onBackspace={kbBackspace} onClear={kbClear} onEnter={() => void handleSave()} onClose={() => setKbTarget(null)} numericOnly={numericKb} />
              )}
              <DialogFooter>
                <button type="button" onClick={closeDialog} disabled={saving} style={{ padding: '10px 20px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <X size={15} />
                  {t.cancel}
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={saving} style={{ padding: '10px 24px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Save size={15} />
                  {saving ? t.saving : t.save}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
            <DialogContent style={{ width: KIOSK_DLG_CONFIRM_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
              <DialogHeader>
                <DialogTitle>{t.deleteTitle}</DialogTitle>
                <DialogDescription>{t.deleteDescription}</DialogDescription>
              </DialogHeader>
              <p style={{ color: colors.text, fontSize: '16px', marginBottom: '20px' }}>{deleteTarget ? t.deleteNamed(deleteTarget.username) : t.deleteConfirm}</p>
              {actionError && (
                <div role="alert" style={{ backgroundColor: '#F2DEDE', color: colors.error, padding: '10px', borderRadius: '6px', marginBottom: '14px' }}>{actionError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} style={{ padding: '10px 20px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>{t.cancel}</button>
                <button type="button" onClick={() => void handleDelete()} disabled={deleting} style={{ padding: '10px 20px', backgroundColor: colors.error, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}>{deleting ? t.deleting : t.delete}</button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeTab === 'tab-access' && showTabAccessEditor && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '22px', color: colors.text }}>{t.tabAccessTitle}</h3>
              {permDirty && <p style={{ margin: '6px 0 0', color: colors.warning ?? '#F59E0B', fontSize: '14px' }}>{t.tabAccessUnsaved}</p>}
            </div>
            {permDirty && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={resetPermissions} disabled={permSaving} style={{ padding: '10px 18px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.grey, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RotateCcw size={18} />
                  {t.tabAccessReset}
                </button>
                <button type="button" onClick={() => void savePermissions()} disabled={permSaving} style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: colors.primary, color: 'white', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Save size={18} />
                  {permSaving ? t.saving : t.tabAccessSave}
                </button>
              </div>
            )}
          </div>
          {permErr && <div style={{ backgroundColor: '#F2DEDE', color: colors.error, padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>{permErr}</div>}
          {permOk && <div style={{ backgroundColor: '#DFF0D8', color: colors.success, padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>{permOk}</div>}
          {permLoading ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: colors.textSecondary }}>{t.tabAccessLoading}</div>
          ) : Object.keys(roleMap).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: colors.textSecondary }}>{t.tabAccessEmpty}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {sortRoleEntries(Object.entries(roleMap))
                .filter(([role]) => role !== 'BYPASS' && (role !== 'ADMIN' || bypassCanEditAdminTabAccess))
                .map(([role, row]) => {
                  const available = [...(row.available_tabs || [])].sort()
                  const roleColor = ROLE_COLORS[role as Role] ?? ROLE_COLORS.NONE
                  return (
                    <div key={role} style={{ backgroundColor: colors.white, borderRadius: '10px', padding: '14px', border: `2px solid ${roleColor.border}`, width: '100%', boxSizing: 'border-box' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                        <h4 style={{ margin: 0, fontSize: '17px', color: colors.text }}>{role}</h4>
                        <span style={{ padding: '4px 12px', borderRadius: '16px', backgroundColor: roleColor.bg, border: `1px solid ${roleColor.border}`, color: roleColor.text, fontWeight: 'bold' }}>{t.levelBadge(row.level)}</span>
                      </div>
                      <p style={{ margin: '0 0 10px', fontSize: '13px', color: colors.textSecondary }}>{t.enabledTabsCount(row.tabs.length, available.length)}</p>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
                          gap: '8px',
                        }}
                      >
                        {available.map(tab => {
                          const has = row.tabs.includes(tab)
                          // 'login' is locked for NONE — always reachable, but shown as a normal active tab.
                          const locked = role === 'NONE' && tab === 'login'
                          const IconC = TAB_ICONS[tab]
                          return (
                            <button
                              key={tab}
                              type="button"
                              disabled={locked}
                              onClick={() => toggleRoleTab(role, tab)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: `2px solid ${has ? colors.primary : colors.border}`,
                                backgroundColor: has ? `${colors.primary}12` : colors.white,
                                cursor: locked ? 'default' : 'pointer',
                                textAlign: 'left',
                                minHeight: '44px',
                                boxSizing: 'border-box',
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                {IconC ? <IconC size={20} style={{ flexShrink: 0, color: has ? colors.primary : colors.textSecondary }} /> : null}
                                <span style={{ fontWeight: 600, color: colors.text, fontSize: '14px' }}>{tabLabel(tab)}</span>
                              </span>
                              <span style={{ fontSize: '12px', color: colors.textSecondary, fontWeight: 600 }}>{has ? '✓' : ''}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
