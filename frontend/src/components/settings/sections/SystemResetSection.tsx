import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { isBypassRole } from '@/types/auth.types'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_DLG_CONFIRM_W, KIOSK_DLG_FORM_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { AlertTriangle, Trash2, Database, RotateCcw, Settings, CheckSquare, Square, Play, FileArchive, Download, Upload, Save, HardDrive, CheckCircle } from 'lucide-react'
import ipcClient from '@/services/ipcClient'
import { settingsApi } from '@/services/settingsApi'
import { usbService, type USBDevice } from '@/services/usbService'
import { USBFileBrowser } from '@/components/reference/USBFileBrowser'
import { SystemOperationLoadingScreen } from '@/components/ui/SystemOperationLoadingScreen'
import ArchiveProgressModal from '@/components/ui/ArchiveProgressModal'
import DialogVirtualKeyboard from '@/components/auth/DialogVirtualKeyboard'
import { Switch } from '@/components/ui/Switch'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ProductionSidebarSettingsCard } from '@/components/settings/sections/ProductionSidebarSettingsCard'

interface ResetOptions {
  all: boolean
  testData: boolean
  calibration: boolean
  state: boolean
  config: boolean
  dryRun: boolean
  noBackup: boolean
}

export default function SystemResetSection() {
  const { colors } = useTheme()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; output: string; error?: string } | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [creatingArchive, setCreatingArchive] = useState(false)
  const [usbConnected, setUsbConnected] = useState(false)
  const [, setUsbDevices] = useState<USBDevice[]>([])
  const [selectedUSBPath, setSelectedUSBPath] = useState<string | null>(null)
  const [_exportingArchiveToUSB, _setExportingArchiveToUSB] = useState(false)
  const selectedUSBPathRef = useRef<string | null>(null)
  const [showUpdateFileBrowser, setShowUpdateFileBrowser] = useState(false)
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false)
  const [selectedUpdateFile, setSelectedUpdateFile] = useState<{ path: string; name: string } | null>(null)
  const [updating, setUpdating] = useState(false)
  const [showUpdateLoading, setShowUpdateLoading] = useState(false)
  const [postUpdateAction, setPostUpdateAction] = useState<'reboot' | 'restart-service' | 'nothing'>('reboot')
  const [exportingArchive, setExportingArchive] = useState(false)
  const [showExportLoading, setShowExportLoading] = useState(false)
  const [showRestoreLoading, setShowRestoreLoading] = useState(false)
  const [showCreateArchiveLoading, setShowCreateArchiveLoading] = useState(false)
  const [serialNumber, setSerialNumber] = useState('')
  const [savingSerialNumber, setSavingSerialNumber] = useState(false)
  const [quickpass, setQuickpass] = useState(false)
  const [savingQuickpass, setSavingQuickpass] = useState(false)
  const [showRestoreFileBrowser, setShowRestoreFileBrowser] = useState(false)
  const [showRestoreFileBrowserLocal, setShowRestoreFileBrowserLocal] = useState(false)
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)
  const [selectedRestoreFile, setSelectedRestoreFile] = useState<{ path: string; name: string } | null>(null)
  const [restoringDatabase, setRestoringDatabase] = useState(false)
  const [backingUpDatabase, setBackingUpDatabase] = useState(false)
  const [showBackupSuccess, setShowBackupSuccess] = useState(false)
  const [showRestoreSuccess, setShowRestoreSuccess] = useState(false)
  const [backupSuccessPath, setBackupSuccessPath] = useState('')
  const [_databaseBackups, setDatabaseBackups] = useState<Array<{ name: string; path: string; size: number; modified: string }>>([])
  const [serialNumberInputActive, setSerialNumberInputActive] = useState(false)
  const serialNumberInputRef = useRef<HTMLInputElement | null>(null)
  const [options, setOptions] = useState<ResetOptions>({
    all: false,
    testData: false,
    calibration: false,
    state: false,
    config: false,
    dryRun: false,
    noBackup: false,
  })

  const hasBypassRole = isBypassRole(user)

  useEffect(() => {
    if (hasBypassRole) {
      loadSerialNumber()
      loadDatabaseBackups()
    }
  }, [hasBypassRole])

  const loadSerialNumber = async () => {
    try {
      const settings = await settingsApi.getSystemSettings()
      setSerialNumber(settings.serial_number || '')
      setQuickpass(settings.quickpass ?? false)
      const saved = (settings as Record<string, unknown>).post_update_action
      if (saved === 'reboot' || saved === 'restart-service' || saved === 'nothing') {
        setPostUpdateAction(saved)
      }
    } catch (err) {
      console.error('Failed to load serial number:', err)
    }
  }

  const handleSaveSerialNumber = useCallback(async () => {
    try {
      setSavingSerialNumber(true)
      setError(null)
      await settingsApi.updateSystemSettings({ serial_number: serialNumber })
      setError(null)
      setSerialNumberInputActive(false)
    } catch (err: any) {
      setError(err.message || 'Failed to save serial number')
    } finally {
      setSavingSerialNumber(false)
    }
  }, [serialNumber])

  const handleQuickpassChange = useCallback(async (checked: boolean) => {
    const previousValue = quickpass
    try {
      setSavingQuickpass(true)
      setError(null)
      // Update optimistically
      setQuickpass(checked)
      await settingsApi.updateSystemSettings({ quickpass: checked })
      // Reload from server to ensure consistency
      const settings = await settingsApi.getSystemSettings(true) // force refresh
      setQuickpass(settings.quickpass ?? false)
      setError(null)
    } catch (err: any) {
      // Rollback on error
      setQuickpass(previousValue)
      setError(err.message || 'Failed to save QuickPass setting')
      console.error('Failed to save QuickPass setting:', err)
    } finally {
      setSavingQuickpass(false)
    }
  }, [quickpass])

  const handleSerialNumberKeyPress = useCallback((key: string) => {
    setSerialNumber(prev => prev + key)
    if (serialNumberInputRef.current) {
      serialNumberInputRef.current.focus()
    }
  }, [])

  const handleSerialNumberBackspace = useCallback(() => {
    setSerialNumber(prev => prev.slice(0, -1))
    if (serialNumberInputRef.current) {
      serialNumberInputRef.current.focus()
    }
  }, [])

  const handleSerialNumberClear = useCallback(() => {
    setSerialNumber('')
    if (serialNumberInputRef.current) {
      serialNumberInputRef.current.focus()
    }
  }, [])

  const handleSerialNumberEnter = useCallback(() => {
    // Just close keyboard - user can click Save button separately
    setSerialNumberInputActive(false)
  }, [])

  const handleCloseSerialNumberKeyboard = useCallback(() => {
    setSerialNumberInputActive(false)
  }, [])

  const loadDatabaseBackups = async () => {
    try {
      const response = await ipcClient.listDatabaseBackups()
      if (response.success) {
        setDatabaseBackups(response.backups || [])
      }
    } catch (err) {
      console.error('Failed to load database backups:', err)
    }
  }

  const handleRestoreFromLocal = () => {
    setShowRestoreFileBrowserLocal(true)
    setError(null)
  }

  const handleRestoreFromUSB = () => {
    if (!usbConnected || !selectedUSBPath) {
      setError('No USB device detected. Please insert a USB drive and wait for it to be detected.')
      return
    }
    setShowRestoreFileBrowser(true)
    setError(null)
  }

  const handleSaveData = async () => {
    setBackingUpDatabase(true)
    setError(null)

    try {
      const response = await settingsApi.backupDatabase()
      
      if (response.status === 'success') {
        setError(null)
        setBackupSuccessPath(response.backup_path || '')
        setShowBackupSuccess(true)
        loadDatabaseBackups()
      } else {
        setError(response.message || 'Database backup failed')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create database backup')
    } finally {
      setBackingUpDatabase(false)
    }
  }

  const handleRestoreFileSelect = (filePath: string, fileName: string) => {
    setSelectedRestoreFile({ path: filePath, name: fileName })
    setShowRestoreFileBrowser(false)
    setShowRestoreConfirmation(true)
  }

  const handleRestoreConfirm = async () => {
    if (!selectedRestoreFile) {
      setError('No backup file selected')
      return
    }

    setShowRestoreConfirmation(false)
    setRestoringDatabase(true)
    setShowRestoreLoading(true)
    setError(null)

    try {
      const response = await ipcClient.restoreDatabase(selectedRestoreFile.path)
      
      if (response.success) {
        setShowRestoreLoading(false)
        setRestoringDatabase(false)
        setError(null)
        setShowRestoreSuccess(true)
        setSelectedRestoreFile(null)
        loadDatabaseBackups()
      } else {
        setShowRestoreLoading(false)
        setRestoringDatabase(false)
        setError(response.error || 'Database restore failed')
      }
    } catch (err: any) {
      setShowRestoreLoading(false)
      setRestoringDatabase(false)
      setError(err.message || 'Failed to restore database')
    }
  }


  useEffect(() => {
    if (!hasBypassRole) {
      return
    }

    usbService.initialize()
    
    // Subscribe to USB status changes
    let isSubscribed = true
    const unsubscribe = usbService.onStatusChange((status) => {
      if (!isSubscribed) return
      
      setUsbConnected(status.usb_connected)
      const newDevices = status.devices || []
      setUsbDevices(newDevices)
      if (newDevices.length > 0) {
        const currentSelectedPath = selectedUSBPathRef.current
        const currentDeviceStillExists = currentSelectedPath && 
          newDevices.some((d: USBDevice) => d.path === currentSelectedPath && d.available)
        
        if (!currentDeviceStillExists) {
          const writableDevice = newDevices.find((d: USBDevice) => d.writable && d.available)
          if (writableDevice) {
            setSelectedUSBPath(writableDevice.path)
          } else {
            const availableDevice = newDevices.find((d: USBDevice) => d.available)
            if (availableDevice) {
              setSelectedUSBPath(availableDevice.path)
            } else if (newDevices.length > 0) {
              setSelectedUSBPath(newDevices[0].path)
            }
          }
        }
      } else {
        setSelectedUSBPath(null)
      }
    })
    
    // Initial USB status check
    usbService.checkStatus().then((status) => {
      if (isSubscribed) {
        setUsbConnected(status.usb_connected)
        const devices = status.devices || []
        setUsbDevices(devices)
        if (devices.length > 0) {
          const writableDevice = devices.find((d: USBDevice) => d.writable && d.available)
          if (writableDevice) {
            setSelectedUSBPath(writableDevice.path)
          } else {
            const availableDevice = devices.find((d: USBDevice) => d.available)
            if (availableDevice) {
              setSelectedUSBPath(availableDevice.path)
            } else {
              setSelectedUSBPath(devices[0].path)
            }
          }
        }
      }
    }).catch((err) => {
      console.error('Error checking USB status:', err)
    })
    
    return () => {
      isSubscribed = false
      unsubscribe()
    }
  }, [hasBypassRole])

  useEffect(() => {
    selectedUSBPathRef.current = selectedUSBPath
  }, [selectedUSBPath])
  if (!hasBypassRole) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
        <AlertTriangle size={48} style={{ margin: '0 auto 20px', color: colors.error }} />
        <p style={{ fontSize: '18px', fontWeight: 'bold' }}>Access Denied</p>
        <p style={{ fontSize: '14px', marginTop: '10px' }}>
          System Reset is only available to accounts with the Bypass role
        </p>
      </div>
    )
  }

  const handleOptionChange = (key: keyof ResetOptions, value: boolean | string) => {
    setOptions(prev => {
      const updated = { ...prev, [key]: value }
      
      if (key === 'all' && value === true) {
        updated.testData = false
        updated.calibration = false
        updated.state = false
        updated.config = false
      } else if (key !== 'all' && value === true) {
        updated.all = false
      }
      
      return updated
    })
  }

  const handleExecute = async () => {
    if (!options.all && !options.testData && !options.calibration && !options.state && !options.config) {
      setError('Please select at least one category to clear')
      return
    }

    setShowConfirmation(true)
    setError(null)
    setResult(null)
  }

  const handleConfirmExecute = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setShowConfirmation(false)

    try {
      const response = await ipcClient.systemReset(options)
      
      setResult({
        success: response.success,
        output: response.success ? 'System reset completed successfully.' : '',
        error: response.error || undefined
      })

      if (!response.success) {
        setError(response.error || 'System reset failed')
      } else {
        setError(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute system reset')
      setResult({
        success: false,
        output: '',
        error: err.message || 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateArchive = async () => {
    try {
      setCreatingArchive(true)
      setShowCreateArchiveLoading(true)
      setError(null)

      // Progress listener is handled by ArchiveProgressModal component
      // No need to manually set it up here

      const response = await ipcClient.createArchive()

      if (response.success) {
        // Don't close immediately - let ArchiveProgressModal show success state
        // Modal will close when user clicks close button
        setCreatingArchive(false)
        setError(null)
      } else {
        setShowCreateArchiveLoading(false)
        setCreatingArchive(false)
        setError(response.error || 'Archive creation failed')
      }
    } catch (err: any) {
      setShowCreateArchiveLoading(false)
      setCreatingArchive(false)
      setError(err.message || 'Failed to create archive')
    }
  }


  const handleExportArchiveToUSB = async () => {
    if (!usbConnected || !selectedUSBPath) {
      setError('No USB device detected. Please insert a USB drive and wait for it to be detected.')
      return
    }

    let cleanupProgressListener: (() => void) | undefined = undefined

    try {
      setExportingArchive(true)
      setShowExportLoading(true)
      setError(null)

      // Set up progress listener
      if (typeof window !== 'undefined' && window.electronAPI && (window.electronAPI as any).onArchiveProgress) {
        cleanupProgressListener = (window.electronAPI as any).onArchiveProgress((progress: any) => {
          // Progress updates will be shown in the loading screen
          console.log('Archive progress:', progress)
        })
      }

      const response = await ipcClient.createAndExportArchiveToUSB(selectedUSBPath)
      
      if (cleanupProgressListener) {
        cleanupProgressListener()
        cleanupProgressListener = undefined
      }

      if (response.success) {
        // Close progress screen immediately after successful export
        setShowExportLoading(false)
        setExportingArchive(false)
        setError(null)
      } else {
        setShowExportLoading(false)
        setExportingArchive(false)
        setError(response.error || 'Failed to create and export archive to USB')
      }
    } catch (err: any) {
      if (cleanupProgressListener) {
        cleanupProgressListener()
        cleanupProgressListener = undefined
      }
      setShowExportLoading(false)
      setExportingArchive(false)
      setError(err.message || 'Failed to create and export archive to USB')
    }
  }

  const handleUpdateClick = () => {
    if (!usbConnected || !selectedUSBPath) {
      setError('No USB device detected. Please insert a USB drive and wait for it to be detected.')
      return
    }
    setShowUpdateFileBrowser(true)
    setError(null)
  }

  const handleUpdateFileSelect = (filePath: string, fileName: string) => {
    setSelectedUpdateFile({ path: filePath, name: fileName })
    setShowUpdateFileBrowser(false)
    setShowUpdateConfirmation(true)
  }

  const handlePostUpdateActionChange = (action: 'reboot' | 'restart-service' | 'nothing') => {
    setPostUpdateAction(action)
    settingsApi.updateSystemSettings({ post_update_action: action } as Parameters<typeof settingsApi.updateSystemSettings>[0]).catch(() => {})
  }

  const handleUpdateConfirm = async () => {
    if (!selectedUpdateFile || !selectedUSBPath) {
      setError('No file selected')
      return
    }

    setShowUpdateConfirmation(false)
    setUpdating(true)
    setShowUpdateLoading(true)
    setError(null)

    try {
      const response = await ipcClient.systemUpdateFromUSB(selectedUSBPath, selectedUpdateFile.path, postUpdateAction)
      
      if (!response.success) {
        setError(response.error || 'System update failed')
        setUpdating(false)
        setShowUpdateLoading(false)
      }
      // If successful and action is reboot, the system will reboot, so we don't need to reset these states
      if (postUpdateAction === 'reboot') {
        // System will reboot, don't reset states
      } else {
        // For restart-service or nothing, reset states after a delay
        setTimeout(() => {
          setUpdating(false)
          setShowUpdateLoading(false)
        }, 2000)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to perform system update')
      setUpdating(false)
      setShowUpdateLoading(false)
    }
  }

  const Checkbox = ({ 
    label, 
    checked, 
    onChange, 
    description,
    icon: Icon 
  }: { 
    label: string
    checked: boolean
    onChange: (checked: boolean) => void
    description?: string
    icon?: any
  }) => (
    <div style={{ 
      display: 'flex', 
      alignItems: 'flex-start', 
      gap: '12px',
      padding: '12px',
      backgroundColor: colors.white,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    }}
    onClick={() => onChange(!checked)}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = colors.grey
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = colors.white
    }}
    >
      <div style={{ marginTop: '2px' }}>
        {checked ? (
          <CheckSquare size={24} color={colors.primary} />
        ) : (
          <Square size={24} color={colors.textSecondary} />
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          marginBottom: description ? '4px' : '0'
        }}>
          {Icon && <Icon size={18} color={colors.textSecondary} />}
          <label style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: colors.text,
            cursor: 'pointer',
            userSelect: 'none'
          }}>
            {label}
          </label>
        </div>
        {description && (
          <p style={{ 
            fontSize: '13px', 
            color: colors.textSecondary,
            margin: 0,
            lineHeight: '1.4'
          }}>
            {description}
          </p>
        )}
      </div>
    </div>
  )

  const renderSystemResetTab = () => {
    return (
      <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Critical Action Section - Prominent at Top */}
        <Section>
          <div style={{
            padding: '18px',
            backgroundColor: colors.white,
            borderRadius: '12px',
            border: `2px solid ${colors.error}`,
            boxShadow: `0 4px 12px ${colors.error}20`
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              marginBottom: '16px'
            }}>
              <div style={{
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: `${colors.error}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <AlertTriangle size={24} color={colors.error} />
              </div>
              <div>
                <h3 style={{ 
                  fontSize: '22px', 
                  fontWeight: '700', 
                  color: colors.error,
                  margin: 0,
                  marginBottom: '4px'
                }}>
                  System Reset
                </h3>
                <p style={{ 
                  fontSize: '14px', 
                  color: colors.textSecondary,
                  margin: 0
                }}>
                  Permanently delete data from the database. This action cannot be undone.
                </p>
              </div>
            </div>
            
            {/* Data Categories Selection */}
            <div style={{
              padding: '20px',
              backgroundColor: colors.background,
              borderRadius: '8px',
              marginBottom: '20px',
              border: `1px solid ${colors.border}`
            }}>
              <h4 style={{ 
                fontSize: '16px', 
                fontWeight: '600', 
                color: colors.text,
                marginBottom: '16px'
              }}>
                Select Data Categories to Clear
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Checkbox
                  label="Clear All Categories"
                  checked={options.all}
                  onChange={(checked) => handleOptionChange('all', checked)}
                  description="Clears all categories: Test & Operational Data, Calibration & Reference Data, State Data, and Configuration Data"
                  icon={Trash2}
                />
                <div style={{ 
                  height: '1px', 
                  backgroundColor: colors.border, 
                  margin: '6px 0' 
                }} />
                <Checkbox
                  label="Test & Operational Data"
                  checked={options.testData}
                  onChange={(checked) => handleOptionChange('testData', checked)}
                  description="Clears: test_runs, chamber_test_results, error_history, audit_log, scan_history, counter_overrides, sessions"
                  icon={Trash2}
                />
                <Checkbox
                  label="Calibration & Reference Data"
                  checked={options.calibration}
                  onChange={(checked) => handleOptionChange('calibration', checked)}
                  description="Clears: calibration_events, chamber_offsets, test_references, reference_chamber_settings"
                  icon={Database}
                />
                <Checkbox
                  label="State Data"
                  checked={options.state}
                  onChange={(checked) => handleOptionChange('state', checked)}
                  description="Resets counter_state: current_counter=0, last_barcode=NULL, last_reference_id=NULL, scan_count=0, reset_pending=0"
                  icon={RotateCcw}
                />
                <Checkbox
                  label="Configuration Data"
                  checked={options.config}
                  onChange={(checked) => handleOptionChange('config', checked)}
                  description="Removes test user accounts and resets user override statistics (override_count, last_override_date)"
                  icon={Settings}
                />
              </div>
              {options.dryRun && (
                <div style={{
                  marginTop: '16px',
                  padding: '10px',
                  backgroundColor: '#FFF3CD',
                  borderRadius: '6px',
                  border: `1px solid #FFC107`,
                  fontSize: '13px',
                  color: '#856404',
                  fontWeight: '600'
                }}>
                  🔍 DRY RUN MODE: Preview only, no changes will be made
                </div>
              )}
            </div>

            <Button
              onClick={handleExecute}
              disabled={loading || (!options.all && !options.testData && !options.calibration && !options.state && !options.config)}
              variant="danger"
              size="lg"
              icon={Play}
              fullWidth
            >
              {loading ? 'Executing...' : options.dryRun ? 'Preview System Reset (Dry Run)' : 'Execute System Reset'}
            </Button>
          </div>
        </Section>

        {/* Machine configuration (single column — avoids empty grid column) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Section>
              <Card 
                title="Machine Configuration" 
                icon={Settings}
                description="Configure machine-specific settings"
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Serial Number */}
                  <div>
                    {serialNumberInputActive && (
                      <div style={{ 
                        padding: '12px', 
                        backgroundColor: `${colors.primary}15`, 
                        borderRadius: '8px',
                        marginBottom: '12px',
                        border: `1px solid ${colors.primary}40`
                      }}>
                        <span style={{ color: colors.primary, fontWeight: '600', fontSize: '13px' }}>
                          Virtual Keyboard Active: Entering text in Serial Number field
                        </span>
                      </div>
                    )}
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ 
                        display: 'block', 
                        marginBottom: '6px', 
                        fontSize: '14px', 
                        fontWeight: '600', 
                        color: colors.text 
                      }}>
                        Serial Number
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          ref={serialNumberInputRef}
                          type="text"
                          value={serialNumber}
                          readOnly
                          onClick={() => setSerialNumberInputActive(true)}
                          placeholder="e.g., Leak-000-001"
                          style={{
                            flex: 1,
                            padding: '10px 12px',
                            fontSize: '14px',
                            border: `2px solid ${serialNumberInputActive ? colors.primary : colors.border}`,
                            borderRadius: '6px',
                            backgroundColor: serialNumberInputActive ? `${colors.primary}10` : colors.white,
                            color: colors.text,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        />
                        <Button
                          onClick={handleSaveSerialNumber}
                          disabled={savingSerialNumber}
                          icon={Save}
                        >
                          {savingSerialNumber ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                      <p style={{ 
                        fontSize: '12px', 
                        color: colors.textSecondary,
                        marginTop: '6px',
                        marginBottom: 0
                      }}>
                        This will be included in exported file names.
                      </p>
                    </div>
                    {serialNumberInputActive && (
                      <DialogVirtualKeyboard
                        onKeyPress={handleSerialNumberKeyPress}
                        onBackspace={handleSerialNumberBackspace}
                        onClear={handleSerialNumberClear}
                        onEnter={handleSerialNumberEnter}
                        onClose={handleCloseSerialNumberKeyboard}
                        activeFieldLabel="Serial Number"
                      />
                    )}
                  </div>

                  <div style={{ 
                    height: '1px', 
                    backgroundColor: colors.border, 
                    margin: '4px 0' 
                  }} />

                  {/* QuickPass */}
                  <div>
                    <label style={{ 
                      display: 'block', 
                      marginBottom: '8px', 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: colors.text 
                    }}>
                      QuickPass
                    </label>
                    <Switch
                      checked={quickpass}
                      onChange={handleQuickpassChange}
                      disabled={savingQuickpass}
                      label="Admin password: 9012 when enabled, Techmac@@Gajoute when disabled"
                    />
                  </div>
                </div>
              </Card>
            </Section>
        </div>

        {/* Backup & Maintenance Operations */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', 
          gap: '16px' 
        }}>
          {/* Database Backup & Restore */}
          <Section>
            <Card 
              title="Database Backup & Restore" 
              icon={Database}
              description="Backup and restore the working database"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Button
                  onClick={handleSaveData}
                  disabled={backingUpDatabase || restoringDatabase}
                  icon={Save}
                  variant="success"
                  fullWidth
                  title="Create a backup of the database and save to ~/databackups"
                >
                  {backingUpDatabase ? 'Saving...' : 'Save Data'}
                </Button>
                <Button
                  onClick={handleRestoreFromLocal}
                  disabled={restoringDatabase || backingUpDatabase}
                  icon={Database}
                  fullWidth
                  title="Restore database from local backups in ~/databackups"
                >
                  {restoringDatabase ? 'Restoring...' : 'Restore from Local'}
                </Button>
                <Button
                  onClick={handleRestoreFromUSB}
                  disabled={restoringDatabase || !usbConnected || !selectedUSBPath}
                  variant="warning"
                  icon={HardDrive}
                  fullWidth
                  title={!usbConnected ? 'No USB device detected' : !selectedUSBPath ? 'No USB path selected' : 'Restore database from USB'}
                >
                  {restoringDatabase ? 'Restoring...' : 'Restore from USB'}
                </Button>
                {!usbConnected && (
                  <p style={{ 
                    fontSize: '12px', 
                    color: colors.textSecondary,
                    margin: 0,
                    fontStyle: 'italic',
                    textAlign: 'center'
                  }}>
                    Insert a USB drive to enable USB restore
                  </p>
                )}
              </div>
            </Card>
          </Section>

          {/* Create Project Archive */}
          <Section>
            <Card 
              title="Create Project Archive" 
              icon={FileArchive}
              description="Create a compressed archive of the entire project directory"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Button
                  onClick={handleCreateArchive}
                  disabled={creatingArchive || exportingArchive}
                  icon={FileArchive}
                  fullWidth
                >
                  {creatingArchive ? 'Creating Archive...' : 'Create Archive Locally'}
                </Button>
                <Button
                  onClick={handleExportArchiveToUSB}
                  disabled={exportingArchive || creatingArchive || !usbConnected || !selectedUSBPath}
                  variant="success"
                  icon={Download}
                  fullWidth
                  title={!usbConnected ? 'No USB device detected' : !selectedUSBPath ? 'No USB path selected' : 'Create archive and export to USB'}
                >
                  {exportingArchive ? 'Creating & Exporting...' : 'Create & Export to USB'}
                </Button>
                {!usbConnected && (
                  <p style={{ 
                    fontSize: '12px', 
                    color: colors.textSecondary,
                    margin: 0,
                    fontStyle: 'italic',
                    textAlign: 'center'
                  }}>
                    Insert a USB drive to enable export functionality
                  </p>
                )}
                <div style={{
                  marginTop: '8px',
                  padding: '10px',
                  backgroundColor: colors.background,
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: colors.textSecondary,
                  fontFamily: 'monospace'
                }}>
                  Equivalent to: cd ~ && tar -czvf /tmp/Air_Leakage_Test_$&#123;serialNumber:-$(date +%Y%m%d)&#125;.tar.gz Air_Leakage_Test
                </div>
              </div>
            </Card>
          </Section>

          {/* System Update */}
          <Section>
            <Card 
              title="System Update" 
              icon={Upload}
              description="Update the system from a .tar.gz archive on USB"
            >
              <div style={{ 
                padding: '12px',
                backgroundColor: `${colors.error}15`,
                borderRadius: '8px',
                border: `1px solid ${colors.error}40`,
                marginBottom: '16px'
              }}>
                <strong style={{ color: colors.error, fontSize: '13px', display: 'block', marginBottom: '4px' }}>
                  ⚠️ WARNING
                </strong>
                <p style={{ 
                  fontSize: '12px', 
                  color: colors.error,
                  margin: 0,
                  lineHeight: '1.5'
                }}>
                  This will replace the entire Air_Leakage_Test directory. The existing installation will be backed up.
                </p>
              </div>

              {/* Post-Update Action Selection */}
              <div style={{
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: colors.background,
                borderRadius: '8px',
                border: `1px solid ${colors.border}`
              }}>
                <p style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: '10px'
                }}>
                  Post-Update Action:
                </p>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px' 
                }}>
                  <div
                    onClick={() => handlePostUpdateActionChange('reboot')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      backgroundColor: postUpdateAction === 'reboot' ? colors.primary + '15' : colors.white,
                      border: `2px solid ${postUpdateAction === 'reboot' ? colors.primary : colors.border}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span style={{ 
                      fontSize: '14px', 
                      color: colors.text,
                      fontWeight: postUpdateAction === 'reboot' ? '600' : '400'
                    }}>
                      Reboot System
                    </span>
                    <Switch
                      checked={postUpdateAction === 'reboot'}
                      onChange={(checked) => {
                        if (checked) handlePostUpdateActionChange('reboot')
                      }}
                    />
                  </div>
                  <div
                    onClick={() => handlePostUpdateActionChange('restart-service')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      backgroundColor: postUpdateAction === 'restart-service' ? colors.primary + '15' : colors.white,
                      border: `2px solid ${postUpdateAction === 'restart-service' ? colors.primary : colors.border}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span style={{ 
                      fontSize: '14px', 
                      color: colors.text,
                      fontWeight: postUpdateAction === 'restart-service' ? '600' : '400'
                    }}>
                      Restart airleakage.service
                    </span>
                    <Switch
                      checked={postUpdateAction === 'restart-service'}
                      onChange={(checked) => {
                        if (checked) handlePostUpdateActionChange('restart-service')
                      }}
                    />
                  </div>
                  <div
                    onClick={() => handlePostUpdateActionChange('nothing')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      backgroundColor: postUpdateAction === 'nothing' ? colors.primary + '15' : colors.white,
                      border: `2px solid ${postUpdateAction === 'nothing' ? colors.primary : colors.border}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span style={{ 
                      fontSize: '14px', 
                      color: colors.text,
                      fontWeight: postUpdateAction === 'nothing' ? '600' : '400'
                    }}>
                      Do Nothing
                    </span>
                    <Switch
                      checked={postUpdateAction === 'nothing'}
                      onChange={(checked) => {
                        if (checked) handlePostUpdateActionChange('nothing')
                      }}
                    />
                  </div>
                </div>
              </div>

              <Button
                onClick={handleUpdateClick}
                disabled={updating || !usbConnected || !selectedUSBPath}
                variant="warning"
                icon={Upload}
                fullWidth
                title={!usbConnected ? 'No USB device detected' : !selectedUSBPath ? 'No USB path selected' : 'Update system from USB archive'}
              >
                {updating ? 'Updating...' : 'Update System'}
              </Button>
              {!usbConnected && (
                <p style={{ 
                  fontSize: '12px', 
                  color: colors.textSecondary,
                  marginTop: '12px',
                  margin: 0,
                  fontStyle: 'italic',
                  textAlign: 'center'
                }}>
                  Insert a USB drive to enable update functionality
                </p>
              )}
              <div style={{
                marginTop: '12px',
                padding: '10px',
                backgroundColor: colors.background,
                borderRadius: '6px',
                fontSize: '12px',
                color: colors.textSecondary,
                fontFamily: 'monospace'
              }}>
                Equivalent to: cd ~ &amp;&amp; tar -xzf /tmp/system_update_archive.tar.gz
              </div>
            </Card>
          </Section>
        </div>


        {/* Status Messages */}
        {(error || result) && (
          <Section>
            {error && (
              <div style={{
                padding: '20px',
                backgroundColor: '#FEE',
                border: `2px solid ${colors.error}`,
                borderRadius: '12px',
                color: colors.error,
                marginBottom: result ? '16px' : 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <AlertTriangle size={20} />
                  <strong style={{ fontSize: '16px' }}>Error</strong>
                </div>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>{error}</p>
              </div>
            )}

            {result && (
              <div style={{
                padding: '24px',
                backgroundColor: result.success ? '#EFE' : '#FEE',
                border: `2px solid ${result.success ? '#10B981' : colors.error}`,
                borderRadius: '12px'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '10px',
                  marginBottom: '12px'
                }}>
                  {result.success ? (
                    <CheckSquare size={20} color="#10B981" />
                  ) : (
                    <AlertTriangle size={20} color={colors.error} />
                  )}
                  <strong style={{ 
                    fontSize: '18px',
                    color: result.success ? '#10B981' : colors.error
                  }}>
                    {result.success ? 'Success' : 'Operation Failed'}
                  </strong>
                </div>
                {result.error && (
                  <div style={{ 
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: '#FEE',
                    borderRadius: '8px',
                    color: colors.error
                  }}>
                    <strong>Error:</strong> {result.error}
                  </div>
                )}
                {result.output && (
                  <div style={{ 
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: colors.white,
                    borderRadius: '8px',
                    border: `1px solid ${colors.border}`
                  }}>
                    <strong style={{ 
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '13px',
                      color: colors.textSecondary
                    }}>
                      Output:
                    </strong>
                    <pre
                      className={KIOSK_TOUCH_SCROLL_CLASS}
                      style={{ 
                      margin: 0,
                      fontSize: '13px',
                      color: colors.text,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '400px',
                      overflowY: 'auto',
                      ...touchScrollable,
                    }}
                    >
                      {result.output}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 'min(16px, 2.5vw)',
          boxSizing: 'border-box',
        }}>
          <div style={{
            backgroundColor: colors.white,
            padding: 'clamp(24px, 4vw, 40px)',
            borderRadius: '14px',
            width: KIOSK_DLG_FORM_W,
            maxWidth: KIOSK_DLG_FORM_W,
            maxHeight: KIOSK_DLG_MAX_H,
            overflowY: 'auto',
            boxSizing: 'border-box',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            ...touchScrollable,
          }}>
            <div style={{ marginBottom: '20px' }}>
              <AlertTriangle size={48} color={colors.error} style={{ marginBottom: '16px' }} />
              <h3 style={{ 
                fontSize: '24px', 
                fontWeight: 'bold', 
                color: colors.error,
                marginBottom: '12px'
              }}>
                ⚠️ DANGER: System Reset
              </h3>
              {options.dryRun ? (
                <div style={{
                  backgroundColor: '#FFF3CD',
                  border: `2px solid #FFC107`,
                  padding: '16px',
                  borderRadius: '8px',
                  marginBottom: '16px'
                }}>
                  <p style={{ 
                    fontSize: '16px', 
                    fontWeight: '600',
                    color: '#856404',
                    marginBottom: '8px'
                  }}>
                    🔍 DRY RUN MODE
                  </p>
                  <p style={{ 
                    fontSize: '14px', 
                    color: '#856404',
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    This is a preview run. <strong>No data will be modified.</strong> The system will show what would be done without making any changes.
                  </p>
                </div>
              ) : (
                <p style={{ 
                  fontSize: '16px', 
                  color: colors.text,
                  lineHeight: '1.6',
                  marginBottom: '16px'
                }}>
                  This action will <strong>permanently delete</strong> data from the database. This cannot be undone.
                </p>
              )}
              <p style={{ 
                fontSize: '14px', 
                color: colors.textSecondary,
                lineHeight: '1.6',
                marginBottom: '20px'
              }}>
                This feature is <strong>strictly restricted to Bypass Admin</strong>. 
                Normal admins cannot access this feature.
              </p>
              <div style={{ 
                backgroundColor: colors.background,
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <p style={{ 
                  fontSize: '14px', 
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: '8px'
                }}>
                  Selected Options:
                </p>
                <ul style={{ 
                  margin: 0,
                  paddingLeft: '20px',
                  color: colors.textSecondary,
                  fontSize: '13px',
                  lineHeight: '1.8'
                }}>
                  {options.all && <li>Clear All Categories</li>}
                  {options.testData && <li>Test & Operational Data</li>}
                  {options.calibration && <li>Calibration & Reference Data</li>}
                  {options.state && <li>State Data</li>}
                  {options.config && <li>Configuration Data</li>}
                  {options.noBackup && <li>Skip Backup (⚠️ Not Recommended)</li>}
                </ul>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowConfirmation(false)
                  setError(null)
                }}
                disabled={loading}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: colors.text,
                  backgroundColor: colors.grey,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmExecute}
                disabled={loading}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: 'white',
                  backgroundColor: loading ? colors.textSecondary : colors.error,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'Executing...' : options.dryRun ? 'Confirm & Preview (Dry Run)' : 'Confirm & Execute'}
              </button>
            </div>
          </div>
        </div>
      )}


      {selectedUSBPath && (
        <USBFileBrowser
          open={showUpdateFileBrowser}
          onClose={() => setShowUpdateFileBrowser(false)}
          onSelectFilePath={handleUpdateFileSelect}
          fileExtension=".tar.gz"
          title="Select Update Archive from USB"
          selectPathOnly={true}
          rootPath={selectedUSBPath}
          rootLabel="USB Drive"
          listFiles={async (dir) => {
            const r = await ipcClient.listUSBFiles(dir, '.tar.gz')
            return r.files || []
          }}
        />
      )}

      <USBFileBrowser
        open={showRestoreFileBrowser}
        onClose={() => setShowRestoreFileBrowser(false)}
        onSelectFilePath={handleRestoreFileSelect}
        fileExtension=".db"
        title="Select Database Backup from USB"
        selectPathOnly={true}
        rootPath={selectedUSBPath || '/'}
        rootLabel="USB Drive"
        listFiles={async (dir) => {
          const r = await ipcClient.listUSBFiles(dir, '.db')
          return r.files || []
        }}
      />

      <USBFileBrowser
        open={showRestoreFileBrowserLocal}
        onClose={() => setShowRestoreFileBrowserLocal(false)}
        onSelectFilePath={handleRestoreFileSelect}
        fileExtension=".db"
        title="Select Database Backup from Local Directory"
        selectPathOnly={true}
        rootPath="/home/pi/databackups"
        rootLabel="Local Backups"
        listFiles={async (dir) => {
          const r = await ipcClient.listLocalFiles(dir, '.db')
          return r.files || []
        }}
      />

      {/* Restore Confirmation Dialog */}
      <Dialog open={showRestoreConfirmation} onOpenChange={(open) => {
        if (!open && !restoringDatabase) {
          setShowRestoreConfirmation(false)
          setSelectedRestoreFile(null)
          setError(null)
        }
      }}>
        <DialogContent style={{
          width: KIOSK_DLG_FORM_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
          padding: 'clamp(24px, 3.5vw, 36px)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}>
          <DialogHeader>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '8px'
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#FEF2F2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <AlertTriangle size={28} color={colors.error} />
              </div>
              <DialogTitle style={{
                fontSize: '24px',
                fontWeight: '700',
                color: colors.error,
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                Database Restore Warning
              </DialogTitle>
            </div>
            <DialogDescription style={{
              fontSize: '15px',
              color: colors.text,
              lineHeight: '1.6',
              marginTop: '12px',
              marginBottom: '20px'
            }}>
              This action will replace the current database with the selected backup file. The current database will be automatically backed up before restoration.
            </DialogDescription>
          </DialogHeader>

          <div style={{
            backgroundColor: '#F9FAFB',
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px'
            }}>
              <Database size={20} color={colors.textSecondary} />
              <p style={{
                fontSize: '14px',
                fontWeight: '600',
                color: colors.text,
                margin: 0
              }}>
                Selected Backup File:
              </p>
            </div>
            <p style={{
              fontSize: '14px',
              color: colors.textSecondary,
              margin: 0,
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              backgroundColor: colors.white,
              padding: '12px',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`
            }}>
              {selectedRestoreFile?.name || 'Unknown'}
            </p>
          </div>

          <div style={{
            backgroundColor: '#FEF2F2',
            border: `1px solid #FECACA`,
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start'
          }}>
            <AlertTriangle size={20} color={colors.error} style={{ flexShrink: 0, marginTop: '2px' }} />
            <p style={{
              fontSize: '14px',
              color: '#991B1B',
              lineHeight: '1.6',
              margin: 0,
              fontWeight: '500'
            }}>
              <strong>Warning:</strong> This action cannot be undone. Make sure you have created a current backup using the "Save Data" button before proceeding.
            </p>
          </div>

          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            marginTop: '8px'
          }}>
            <Button
              onClick={() => {
                setShowRestoreConfirmation(false)
                setSelectedRestoreFile(null)
                setError(null)
              }}
              disabled={restoringDatabase}
              variant="secondary"
              style={{
                minWidth: '120px'
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRestoreConfirm}
              disabled={restoringDatabase}
              variant="danger"
              style={{
                minWidth: '160px'
              }}
            >
              {restoringDatabase ? 'Restoring...' : 'Confirm & Restore'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Backup Success Dialog */}
      <Dialog open={showBackupSuccess} onOpenChange={setShowBackupSuccess}>
        <DialogContent style={{
          width: KIOSK_DLG_CONFIRM_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
          padding: 'clamp(24px, 3.5vw, 36px)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}>
          <DialogHeader>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '8px'
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#F0FDF4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <CheckCircle size={28} color="#16A34A" />
              </div>
              <DialogTitle style={{
                fontSize: '24px',
                fontWeight: '700',
                color: '#16A34A',
                margin: 0
              }}>
                Backup Created Successfully
              </DialogTitle>
            </div>
            <DialogDescription style={{
              fontSize: '15px',
              color: colors.text,
              lineHeight: '1.6',
              marginTop: '12px'
            }}>
              Your database has been backed up successfully to the databackups directory.
            </DialogDescription>
          </DialogHeader>

          <div style={{
            backgroundColor: '#F9FAFB',
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '16px',
            marginTop: '20px',
            marginBottom: '24px'
          }}>
            <p style={{
              fontSize: '13px',
              fontWeight: '600',
              color: colors.textSecondary,
              margin: '0 0 8px 0'
            }}>
              Backup Location:
            </p>
            <p style={{
              fontSize: '13px',
              color: colors.text,
              margin: 0,
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              backgroundColor: colors.white,
              padding: '10px',
              borderRadius: '6px',
              border: `1px solid ${colors.border}`
            }}>
              {backupSuccessPath}
            </p>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '8px'
          }}>
            <Button
              onClick={() => setShowBackupSuccess(false)}
              variant="success"
              style={{
                minWidth: '120px'
              }}
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore Success Dialog */}
      <Dialog open={showRestoreSuccess} onOpenChange={setShowRestoreSuccess}>
        <DialogContent style={{
          width: KIOSK_DLG_CONFIRM_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
          padding: 'clamp(24px, 3.5vw, 36px)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}>
          <DialogHeader>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '8px'
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#F0FDF4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <CheckCircle size={28} color="#16A34A" />
              </div>
              <DialogTitle style={{
                fontSize: '24px',
                fontWeight: '700',
                color: '#16A34A',
                margin: 0
              }}>
                Database Restored Successfully
              </DialogTitle>
            </div>
            <DialogDescription style={{
              fontSize: '15px',
              color: colors.text,
              lineHeight: '1.6',
              marginTop: '12px'
            }}>
              The database has been restored from the backup file. The application may need to be restarted for changes to take full effect.
            </DialogDescription>
          </DialogHeader>

          <div style={{
            backgroundColor: '#FEF3C7',
            border: `1px solid #FCD34D`,
            borderRadius: '12px',
            padding: '16px',
            marginTop: '20px',
            marginBottom: '24px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start'
          }}>
            <AlertTriangle size={20} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
            <p style={{
              fontSize: '14px',
              color: '#92400E',
              lineHeight: '1.6',
              margin: 0,
              fontWeight: '500'
            }}>
              <strong>Note:</strong> Please restart the application to ensure all changes are properly loaded.
            </p>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '8px'
          }}>
            <Button
              onClick={() => setShowRestoreSuccess(false)}
              variant="success"
              style={{
                minWidth: '120px'
              }}
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Update Confirmation Dialog */}
      {showUpdateConfirmation && selectedUpdateFile && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 'min(16px, 2.5vw)',
          boxSizing: 'border-box',
        }}>
          <div style={{
            backgroundColor: colors.white,
            padding: 'clamp(24px, 4vw, 40px)',
            borderRadius: '14px',
            width: KIOSK_DLG_FORM_W,
            maxWidth: KIOSK_DLG_FORM_W,
            maxHeight: KIOSK_DLG_MAX_H,
            overflowY: 'auto',
            boxSizing: 'border-box',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            ...touchScrollable,
          }}>
            <div style={{ marginBottom: '20px' }}>
              <AlertTriangle size={48} color={colors.error} style={{ marginBottom: '16px' }} />
              <h3 style={{ 
                fontSize: '24px', 
                fontWeight: 'bold', 
                color: colors.error,
                marginBottom: '12px'
              }}>
                ⚠️ DANGER: System Update
              </h3>
              <p style={{ 
                fontSize: '16px', 
                color: colors.text,
                lineHeight: '1.6',
                marginBottom: '16px'
              }}>
                This action will:
              </p>
              <ul style={{ 
                fontSize: '14px', 
                color: colors.text,
                lineHeight: '1.8',
                marginBottom: '16px',
                paddingLeft: '20px'
              }}>
                <li>Backup the existing directory to <code>/home/bot/Air_Leakage_Test_Backup</code></li>
                <li>Extract the selected archive: <code>cd ~ &amp;&amp; tar -xzf /tmp/system_update_archive.tar.gz</code></li>
                <li>Perform post-update action: <strong>{postUpdateAction === 'reboot' ? 'Reboot System' : postUpdateAction === 'restart-service' ? 'Restart airleakage.service' : 'Do Nothing'}</strong></li>
              </ul>
              
              <div style={{
                marginBottom: '20px',
                padding: '12px',
                backgroundColor: colors.background,
                borderRadius: '8px',
                border: `1px solid ${colors.border}`
              }}>
                <p style={{
                  fontSize: '13px',
                  color: colors.textSecondary,
                  margin: 0
                }}>
                  <strong>Note:</strong> Post-update action can be changed in the System Update card before selecting the archive.
                </p>
              </div>
              <div style={{ 
                backgroundColor: colors.background,
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <p style={{ 
                  fontSize: '14px', 
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: '8px'
                }}>
                  Selected Archive:
                </p>
                <p style={{ 
                  fontSize: '13px',
                  color: colors.textSecondary,
                  margin: 0,
                  wordBreak: 'break-word'
                }}>
                  {selectedUpdateFile.name}
                </p>
              </div>
              <p style={{ 
                fontSize: '14px', 
                color: colors.error,
                lineHeight: '1.6',
                marginBottom: '20px',
                fontWeight: 'bold'
              }}>
                ⚠️ This action cannot be undone. Make sure you have a backup before proceeding.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowUpdateConfirmation(false)
                  setSelectedUpdateFile(null)
                  setError(null)
                }}
                disabled={updating}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: colors.text,
                  backgroundColor: colors.grey,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  cursor: updating ? 'not-allowed' : 'pointer',
                  opacity: updating ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateConfirm}
                disabled={updating}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: 'white',
                  backgroundColor: updating ? colors.textSecondary : colors.error,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: updating ? 'not-allowed' : 'pointer',
                  opacity: updating ? 0.6 : 1,
                }}
              >
                {updating ? 'Updating...' : 'Confirm & Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SystemOperationLoadingScreen
        open={showUpdateLoading}
        title="System Update in Progress"
        message={
          postUpdateAction === 'reboot'
            ? "Please wait while the system is being updated. The existing installation will be backed up, the archive will be extracted, and the system will reboot automatically when complete."
            : postUpdateAction === 'restart-service'
            ? "Please wait while the system is being updated. The existing installation will be backed up, the archive will be extracted, and the airleakage.service will be restarted when complete."
            : "Please wait while the system is being updated. The existing installation will be backed up and the archive will be extracted. No action will be taken after completion."
        }
        operation="update"
      />
      
      <SystemOperationLoadingScreen
        open={showExportLoading}
        title="Creating Archive and Exporting to USB"
        message="Please wait while the archive is being created and copied to the USB device. This may take a few minutes depending on the size of the project."
        operation="export"
      />

      <ArchiveProgressModal
        isOpen={showCreateArchiveLoading}
        onClose={() => {
          setShowCreateArchiveLoading(false)
          setCreatingArchive(false)
          setError(null)
        }}
        onProgress={(progress) => {
          // Optional: Log progress for debugging
          console.log('Archive progress:', progress)
        }}
      />

      <SystemOperationLoadingScreen
        open={showRestoreLoading}
        title="Restoring Database"
        message="Please wait while the database is being restored from the backup file. This may take a few moments."
        operation="update"
      />


      </>
    )
  }


  return (
    <div
      style={{
        padding: 0,
        width: '100%',
        boxSizing: 'border-box',
        margin: 0,
        backgroundColor: 'transparent',
      }}
    >
      <Section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderRadius: '12px',
              backgroundColor: `${colors.error}18`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={28} color={colors.error} strokeWidth={2.25} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 700,
                color: colors.text,
                margin: 0,
                marginBottom: '6px',
                letterSpacing: '-0.02em',
              }}
            >
              System Management
            </h1>
            <p
              style={{
                fontSize: '14px',
                color: colors.textSecondary,
                margin: 0,
                lineHeight: 1.55,
                maxWidth: '52ch',
              }}
            >
              System reset, backup, USB update, and machine settings. Restricted to the Bypass role.
            </p>
          </div>
        </div>
      </Section>

      <div
        style={{
          backgroundColor: colors.grey,
          borderRadius: '14px',
          padding: '18px 20px',
          border: `1px solid ${colors.border}`,
          boxShadow: colors.shadowCard,
        }}
      >
        <ProductionSidebarSettingsCard />
        {renderSystemResetTab()}
      </div>
    </div>
  )
}


