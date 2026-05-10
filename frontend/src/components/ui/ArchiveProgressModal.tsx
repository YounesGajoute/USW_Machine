import { useEffect, useState, useRef } from 'react'
import { KIOSK_DLG_FORM_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'
import { Loader2, CheckCircle, X, FileArchive, Copy, Check, Sparkles, AlertTriangle, Clock, HardDrive } from 'lucide-react'

// Enhanced CSS animations
if (typeof document !== 'undefined' && !document.getElementById('archive-modal-styles')) {
  const style = document.createElement('style')
  style.id = 'archive-modal-styles'
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.9; transform: scale(1.03); }
    }
    @keyframes shimmer {
      0% { background-position: -1000px 0; }
      100% { background-position: 1000px 0; }
    }
    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(30px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    @keyframes successPulse {
      0% { transform: scale(0.8); opacity: 0; }
      50% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes ripple {
      0% { transform: scale(0.8); opacity: 0.6; }
      100% { transform: scale(2); opacity: 0; }
    }
    @keyframes progressGlow {
      0%, 100% { box-shadow: 0 0 15px rgba(59, 130, 246, 0.4); }
      50% { box-shadow: 0 0 25px rgba(59, 130, 246, 0.6); }
    }
  `
  document.head.appendChild(style)
}

const colors = {
  primary: '#3B82F6',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  text: '#1F2937',
  textSecondary: '#6B7280',
  grey: '#E5E7EB',
  border: '#D1D5DB',
  white: '#FFFFFF',
}

interface ArchiveProgress {
  progress: number
  message: string
  fileCount?: number
  archivePath?: string
  archiveSize?: number
  stage?: 'authorization' | 'filename' | 'creation' | 'verification' | 'complete' | 'export'
  archiveName?: string
}

interface ArchiveProgressModalProps {
  isOpen: boolean
  onClose: () => void
  onProgress: (progress: ArchiveProgress) => void
}

export default function ArchiveProgressModal({ isOpen, onClose, onProgress }: ArchiveProgressModalProps) {
  const [progress, setProgress] = useState<ArchiveProgress>({
    progress: 0,
    message: 'Initializing...',
    stage: 'filename',
  })
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)
  const [archiveName, setArchiveName] = useState<string | null>(null)
  const [showRipple, setShowRipple] = useState(false)
  const startTimeRef = useRef<number>(Date.now())
  const progressHistoryRef = useRef<Array<{ time: number; progress: number }>>([])
  const lastProgressUpdateRef = useRef<number>(0)
  const lastTimeUpdateRef = useRef<number>(Date.now())

  const workflowSteps = [
    { id: 'filename', label: 'Generate Filename', description: 'Creating archive identifier', icon: '📝' },
    { id: 'creation', label: 'Create Archive', description: 'Compressing files with tar', icon: '📦' },
    { id: 'verification', label: 'Verify Archive', description: 'Checking integrity and size', icon: '✓' },
  ]

  const usbExportSteps = [
    { id: 'filename', label: 'Generate Filename', description: 'Creating archive identifier', icon: '📝' },
    { id: 'creation', label: 'Create Archive', description: 'Compressing files (0-70%)', icon: '📦' },
    { id: 'export', label: 'Export to USB', description: 'Copying to USB device (70-100%)', icon: '💾' },
  ]

  const isUSBExport = progress.stage === 'export' || progress.message?.toLowerCase().includes('usb') || progress.message?.toLowerCase().includes('export')
  const activeWorkflowSteps = isUSBExport ? usbExportSteps : workflowSteps

  useEffect(() => {
    if (!isOpen) {
      setProgress({ progress: 0, message: 'Initializing...', stage: 'filename' })
      setIsComplete(false)
      setError(null)
      setEstimatedTimeRemaining(null)
      setArchiveName(null)
      setShowRipple(false)
      progressHistoryRef.current = []
      lastProgressUpdateRef.current = 0
      lastTimeUpdateRef.current = Date.now()
      return
    }

    startTimeRef.current = Date.now()
    setProgress(prev => ({ ...prev, stage: 'filename', message: 'Initializing...' }))

    const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
    if (!isElectron) {
      setError('Not running in Electron environment')
      return
    }

    let cleanup: (() => void) | null = null

    if (window.electronAPI?.onArchiveProgress) {
      cleanup = (window.electronAPI.onArchiveProgress as unknown as (cb: (data: ArchiveProgress) => void) => (() => void))((progressData: ArchiveProgress) => {
        let stage = progressData.stage
        if (!stage) {
          if (progressData.progress < 5) {
            stage = 'filename'
          } else if (progressData.progress < 70) {
            stage = 'creation'
          } else if (progressData.progress >= 70 && progressData.progress < 100) {
            const message = progressData.message?.toLowerCase() || ''
            stage = message.includes('usb') || message.includes('export') || message.includes('copying') ? 'export' : 'verification'
          } else {
            stage = 'complete'
          }
        }

        if (progressData.archivePath && !archiveName) {
          const name = progressData.archivePath.split('/').pop() || null
          if (name) setArchiveName(name)
        }

        const clampedProgress = Math.max(0, Math.min(100, progressData.progress))
        const updatedProgress = { ...progressData, progress: clampedProgress, stage }
        setProgress(updatedProgress)
        onProgress(updatedProgress)

        // Time estimation logic
        const now = Date.now()
        if (clampedProgress !== lastProgressUpdateRef.current) {
          progressHistoryRef.current.push({ time: now, progress: clampedProgress })
          lastProgressUpdateRef.current = clampedProgress
          lastTimeUpdateRef.current = now
          
          if (progressHistoryRef.current.length > 20) {
            progressHistoryRef.current.shift()
          }
        }

        const timeSinceLastUpdate = (now - lastTimeUpdateRef.current) / 1000
        const isStalled = timeSinceLastUpdate > 10 && clampedProgress < 100

        if (clampedProgress > 0 && clampedProgress < 100 && progressHistoryRef.current.length >= 2 && !isStalled) {
          const recentHistory = progressHistoryRef.current.slice(-10)
          
          if (recentHistory.length >= 2) {
            let totalProgressDelta = 0
            let totalTimeDelta = 0
            let validSamples = 0
            
            for (let i = 1; i < recentHistory.length; i++) {
              const progressDelta = recentHistory[i].progress - recentHistory[i - 1].progress
              const timeDelta = (recentHistory[i].time - recentHistory[i - 1].time) / 1000
              
              if (timeDelta > 0.1 && progressDelta >= 0) {
                totalProgressDelta += progressDelta
                totalTimeDelta += timeDelta
                validSamples++
              }
            }
            
            if (validSamples >= 2 && totalTimeDelta > 0 && totalProgressDelta > 0) {
              const averageRate = totalProgressDelta / totalTimeDelta
              
              if (averageRate > 0.001) {
                const remainingProgress = 100 - clampedProgress
                const estimatedSeconds = remainingProgress / averageRate
                
                if (estimatedSeconds >= 1 && estimatedSeconds <= 3600) {
                  setEstimatedTimeRemaining(Math.round(estimatedSeconds))
                } else if (estimatedSeconds > 3600) {
                  setEstimatedTimeRemaining(3600)
                } else {
                  setEstimatedTimeRemaining(null)
                }
              } else {
                setEstimatedTimeRemaining(null)
              }
            } else {
              setEstimatedTimeRemaining(null)
            }
          }
        } else if (clampedProgress >= 100) {
          setEstimatedTimeRemaining(0)
        } else {
          setEstimatedTimeRemaining(null)
        }

        if (clampedProgress === 100 || progressData.archivePath) {
          setIsComplete(true)
          setShowRipple(true)
          setEstimatedTimeRemaining(0)
        }
      })
    }

    return () => {
      if (cleanup) cleanup()
    }
  }, [isOpen, onProgress, archiveName])

  if (!isOpen) return null

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)',
        animation: 'fadeIn 0.2s ease-out',
        padding: 'min(16px, 2.5vw)',
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && isComplete) {
          onClose()
        }
      }}
    >
      <div
        style={{
          backgroundColor: colors.white,
          padding: 'clamp(28px, 4vw, 48px)',
          borderRadius: '20px',
          width: KIOSK_DLG_FORM_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)',
          animation: 'slideInUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          position: 'relative',
          overflowX: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Animated top accent */}
        {!isComplete && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '5px',
            background: `linear-gradient(90deg, ${colors.primary} 0%, #60a5fa 50%, ${colors.primary} 100%)`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 2s linear infinite',
          }} />
        )}

        {/* Success ripple effect */}
        {showRipple && isComplete && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '100px',
            height: '100px',
            marginLeft: '-50px',
            marginTop: '-50px',
            borderRadius: '50%',
            border: `3px solid ${colors.success}`,
            animation: 'ripple 0.6s ease-out',
            pointerEvents: 'none',
          }} />
        )}

        {/* Header */}
        <div style={{ marginBottom: '32px', textAlign: 'center', position: 'relative' }}>
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '16px' }}>
            {isComplete ? (
              <div style={{ animation: 'successPulse 0.6s ease-out' }}>
                <CheckCircle size={64} color={colors.success} strokeWidth={2.5} />
              </div>
            ) : (
              <div style={{ position: 'relative', animation: 'pulse 2s ease-in-out infinite' }}>
                <FileArchive size={64} color={colors.primary} strokeWidth={2} />
                <div style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  animation: 'spin 2s linear infinite',
                }}>
                  <Sparkles size={24} color={colors.primary} fill={colors.primary} opacity={0.7} />
                </div>
              </div>
            )}
          </div>
          
          <h2 style={{
            fontSize: '28px',
            fontWeight: '800',
            color: colors.text,
            marginBottom: '12px',
            background: isComplete 
              ? `linear-gradient(135deg, ${colors.success} 0%, #22c55e 100%)`
              : `linear-gradient(135deg, ${colors.primary} 0%, #60a5fa 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.03em',
          }}>
            {isComplete ? 'Archive Complete!' : 'Creating Archive'}
          </h2>
          
          <p style={{
            fontSize: '16px',
            color: colors.textSecondary,
            margin: 0,
            lineHeight: '1.6',
            maxWidth: 'min(90vw, 560px)',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            {isComplete 
              ? 'Your archive has been successfully created and is ready to use' 
              : progress.message || 'Please wait while we process your files...'}
          </p>

          {archiveName && !isComplete && (
            <div style={{
              marginTop: '16px',
              padding: '10px 16px',
              backgroundColor: `${colors.primary}12`,
              borderRadius: '8px',
              fontSize: '13px',
              color: colors.text,
              fontFamily: 'monospace',
              display: 'inline-block',
              border: `1px solid ${colors.primary}30`,
            }}>
              <FileArchive size={14} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle' }} />
              {archiveName}
            </div>
          )}
        </div>

        {/* Workflow Steps */}
        {!isComplete && progress.stage && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '20px',
              position: 'relative',
            }}>
              {/* Progress line */}
              <div style={{
                position: 'absolute',
                top: '16px',
                left: '10%',
                right: '10%',
                height: '3px',
                backgroundColor: `${colors.grey}`,
                zIndex: 0,
              }}>
                <div style={{
                  height: '100%',
                  width: `${((activeWorkflowSteps.findIndex(s => s.id === progress.stage) + 1) / activeWorkflowSteps.length) * 100}%`,
                  backgroundColor: colors.primary,
                  transition: 'width 0.5s ease',
                }} />
              </div>

              {activeWorkflowSteps.map((step, index) => {
                const isActive = progress.stage === step.id
                const currentStepIndex = activeWorkflowSteps.findIndex(s => s.id === progress.stage)
                const isCompleted = currentStepIndex > index

                return (
                  <div
                    key={step.id}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: isCompleted 
                        ? colors.success 
                        : isActive 
                        ? colors.primary 
                        : colors.white,
                      color: isCompleted || isActive ? 'white' : colors.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      fontWeight: '700',
                      border: isActive 
                        ? `3px solid ${colors.primary}` 
                        : isCompleted
                        ? `3px solid ${colors.success}`
                        : `3px solid ${colors.grey}`,
                      boxShadow: isActive 
                        ? `0 0 0 4px ${colors.primary}20, 0 4px 8px rgba(0,0,0,0.1)` 
                        : isCompleted
                        ? `0 0 0 4px ${colors.success}20, 0 4px 8px rgba(0,0,0,0.1)`
                        : '0 2px 4px rgba(0,0,0,0.05)',
                      transition: 'all 0.3s ease',
                      animation: isActive ? 'progressGlow 2s ease-in-out infinite' : 'none',
                    }}>
                      {isCompleted ? '✓' : step.icon}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: isActive ? colors.primary : isCompleted ? colors.success : colors.textSecondary,
                      fontWeight: isActive || isCompleted ? '600' : '500',
                      textAlign: 'center',
                      lineHeight: '1.3',
                      maxWidth: '90px',
                    }}>
                      {step.label}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Current step description */}
            <div style={{
              padding: '12px 16px',
              backgroundColor: `${colors.primary}10`,
              borderRadius: '10px',
              fontSize: '13px',
              color: colors.text,
              textAlign: 'center',
              fontWeight: '500',
              border: `1px solid ${colors.primary}20`,
            }}>
              {activeWorkflowSteps.find(s => s.id === progress.stage)?.description || 'Processing...'}
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {!isComplete && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
            }}>
              <span style={{
                fontSize: '14px',
                fontWeight: '600',
                color: colors.text,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Progress
              </span>
              <span style={{
                fontSize: '22px',
                fontWeight: '800',
                color: colors.primary,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(progress.progress)}%
              </span>
            </div>

            {/* Enhanced progress bar */}
            <div style={{
              width: '100%',
              height: '32px',
              backgroundColor: `${colors.grey}60`,
              borderRadius: '16px',
              overflow: 'hidden',
              marginBottom: '20px',
              position: 'relative',
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.08)',
              border: `1px solid ${colors.border}`,
            }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, progress.progress))}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${colors.primary} 0%, #60a5fa 50%, ${colors.primary} 100%)`,
                  backgroundSize: '200% 100%',
                  transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                  animation: progress.progress > 0 ? 'shimmer 2s linear infinite' : 'none',
                  boxShadow: progress.progress > 0 ? '0 0 15px rgba(59, 130, 246, 0.5)' : 'none',
                  position: 'relative',
                }}
              >
                {progress.progress > 20 && (
                  <div style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '700',
                    textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}>
                    {Math.round(progress.progress)}%
                  </div>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: estimatedTimeRemaining !== null && progress.fileCount ? '1fr 1fr' : '1fr',
              gap: '16px',
            }}>
              {progress.fileCount !== undefined && progress.fileCount > 0 && (
                <div style={{
                  padding: '16px',
                  backgroundColor: `${colors.primary}08`,
                  borderRadius: '12px',
                  textAlign: 'center',
                  border: `1px solid ${colors.primary}20`,
                }}>
                  <div style={{
                    fontSize: '12px',
                    color: colors.textSecondary,
                    marginBottom: '6px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Files Processed
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: '800',
                    color: colors.primary,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {progress.fileCount.toLocaleString()}
                  </div>
                </div>
              )}
              
              {estimatedTimeRemaining !== null && estimatedTimeRemaining >= 0 && (
                <div style={{
                  padding: '16px',
                  backgroundColor: `${colors.primary}08`,
                  borderRadius: '12px',
                  textAlign: 'center',
                  border: `1px solid ${colors.primary}20`,
                }}>
                  <div style={{
                    fontSize: '12px',
                    color: colors.textSecondary,
                    marginBottom: '6px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                  }}>
                    <Clock size={12} />
                    Time Remaining
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: '800',
                    color: colors.primary,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatTime(estimatedTimeRemaining)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success State */}
        {isComplete && progress.archivePath && (
          <div style={{
            padding: '28px',
            background: `linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)`,
            border: `2px solid ${colors.success}`,
            borderRadius: '16px',
            marginBottom: '28px',
            boxShadow: `0 8px 24px ${colors.success}25`,
            animation: 'slideInUp 0.5s ease-out',
          }}>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '12px'
              }}>
                <strong style={{ 
                  color: colors.success, 
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <CheckCircle size={18} />
                  Archive Location
                </strong>
                <button
                  onClick={() => copyToClipboard(progress.archivePath!)}
                  style={{
                    padding: '8px 14px',
                    fontSize: '13px',
                    backgroundColor: copied ? colors.success : 'white',
                    border: `2px solid ${colors.success}`,
                    borderRadius: '8px',
                    color: copied ? 'white' : colors.success,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: '700',
                    transition: 'all 0.2s ease',
                    boxShadow: copied ? `0 4px 12px ${colors.success}40` : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!copied) {
                      e.currentTarget.style.backgroundColor = `${colors.success}10`
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!copied) {
                      e.currentTarget.style.backgroundColor = 'white'
                    }
                  }}
                >
                  {copied ? (
                    <>
                      <Check size={16} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy Path
                    </>
                  )}
                </button>
              </div>
              
              <div style={{
                fontSize: '13px',
                color: colors.text,
                wordBreak: 'break-all',
                backgroundColor: 'white',
                padding: '14px',
                borderRadius: '10px',
                fontFamily: 'monospace',
                border: `2px solid ${colors.success}30`,
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)',
                lineHeight: '1.5',
              }}>
                {progress.archivePath}
              </div>
            </div>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: progress.archiveSize && progress.fileCount ? '1fr 1fr' : '1fr',
              gap: '16px',
            }}>
              {progress.archiveSize && (
                <div style={{
                  padding: '16px',
                  backgroundColor: 'white',
                  borderRadius: '10px',
                  border: `2px solid ${colors.success}30`,
                }}>
                  <div style={{ 
                    color: colors.textSecondary, 
                    fontSize: '12px', 
                    marginBottom: '8px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <HardDrive size={14} />
                    Archive Size
                  </div>
                  <div style={{ 
                    fontSize: '22px', 
                    color: colors.text, 
                    fontWeight: '800',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatFileSize(progress.archiveSize)}
                  </div>
                </div>
              )}
              
              {progress.fileCount !== undefined && (
                <div style={{
                  padding: '16px',
                  backgroundColor: 'white',
                  borderRadius: '10px',
                  border: `2px solid ${colors.success}30`,
                }}>
                  <div style={{ 
                    color: colors.textSecondary, 
                    fontSize: '12px', 
                    marginBottom: '8px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Files Archived
                  </div>
                  <div style={{ 
                    fontSize: '22px', 
                    color: colors.text, 
                    fontWeight: '800',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {progress.fileCount.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div style={{
            padding: '20px',
            background: `linear-gradient(135deg, #FEE 0%, #FDD 100%)`,
            border: `2px solid ${colors.error}`,
            borderRadius: '12px',
            marginBottom: '24px',
            color: colors.error,
            boxShadow: `0 4px 12px ${colors.error}20`,
            animation: 'slideInUp 0.4s ease-out',
            position: 'relative',
            zIndex: 2,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '8px',
            }}>
              <AlertTriangle size={20} color={colors.error} />
              <strong style={{ fontSize: '16px', fontWeight: '700' }}>
                Error {progress.stage ? `- ${activeWorkflowSteps.find(s => s.id === progress.stage)?.label || 'Unknown Stage'}` : ''}
              </strong>
            </div>
            <p style={{
              margin: 0,
              fontSize: '14px',
              lineHeight: '1.5',
              paddingLeft: '32px',
            }}>
              {error}
            </p>
            {progress.stage && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                backgroundColor: 'rgba(255,255,255,0.5)',
                borderRadius: '6px',
                fontSize: '12px',
                color: colors.error,
              }}>
                Failed at: <strong>{activeWorkflowSteps.find(s => s.id === progress.stage)?.description || progress.stage}</strong>
              </div>
            )}
          </div>
        )}

        {/* Close Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 2 }}>
          <button
            onClick={onClose}
            style={{
              padding: '14px 28px',
              fontSize: '16px',
              fontWeight: '600',
              color: 'white',
              background: isComplete 
                ? `linear-gradient(135deg, ${colors.success}, #22c55e)`
                : `linear-gradient(135deg, ${colors.primary}, #60a5fa)`,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: isComplete 
                ? `0 4px 12px ${colors.success}40`
                : `0 4px 12px ${colors.primary}40`,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = isComplete 
                ? `0 6px 16px ${colors.success}50`
                : `0 6px 16px ${colors.primary}50`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = isComplete 
                ? `0 4px 12px ${colors.success}40`
                : `0 4px 12px ${colors.primary}40`
            }}
          >
            {isComplete ? (
              <>
                <CheckCircle size={20} />
                Close
              </>
            ) : (
              <>
                <X size={20} />
                Cancel
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
