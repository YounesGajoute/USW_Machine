import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_DLG_WIDE_FORM_W } from '@/lib/kioskDialogSizing'

interface SystemOperationLoadingScreenProps {
  open: boolean
  title: string
  message: string
  operation?: 'update' | 'export'
}

export function SystemOperationLoadingScreen({
  open,
  title,
  message,
  operation = 'update'
}: SystemOperationLoadingScreenProps) {
  const { colors } = useTheme()
  if (!open) return null

  const isUpdate = operation === 'update'
  const primaryColor = isUpdate ? colors.error : colors.primary
  const secondaryColor = isUpdate ? '#ff6b6b' : '#4dabf7'

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.white,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      overflow: 'hidden'
    }}>
      {/* Animated background with multiple gradients */}
      <div style={{
        position: 'absolute',
        top: '-50%',
        left: '-50%',
        width: '200%',
        height: '200%',
        background: `radial-gradient(circle at 30% 40%, ${primaryColor}12 0%, transparent 50%),
                     radial-gradient(circle at 70% 60%, ${secondaryColor}10 0%, transparent 50%)`,
        animation: 'float-bg 8s ease-in-out infinite',
        pointerEvents: 'none'
      }} />

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: `${20 + i * 10}px`,
            height: `${20 + i * 10}px`,
            border: `2px solid ${i % 2 === 0 ? primaryColor : secondaryColor}20`,
            borderRadius: '50%',
            left: `${15 + i * 12}%`,
            top: `${10 + i * 15}%`,
            animation: `float-particle ${3 + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.3}s`,
            pointerEvents: 'none'
          }}
        />
      ))}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '40px',
        position: 'relative',
        zIndex: 1,
        width: KIOSK_DLG_WIDE_FORM_W,
        maxWidth: '100%',
        padding: 'clamp(24px, 4vw, 48px)',
        boxSizing: 'border-box',
      }}>
        {/* Enhanced animated loader */}
        <div style={{
          position: 'relative',
          width: '140px',
          height: '140px'
        }}>
          {/* Outer glow effect */}
          <div style={{
            position: 'absolute',
            width: '140px',
            height: '140px',
            background: `radial-gradient(circle, ${primaryColor}20 0%, transparent 70%)`,
            borderRadius: '50%',
            animation: 'glow-pulse 2s ease-in-out infinite'
          }} />

          {/* Outer rotating ring with gradient */}
          <div style={{
            position: 'absolute',
            width: '140px',
            height: '140px',
            background: `conic-gradient(from 0deg, transparent 0deg, ${primaryColor} 90deg, ${secondaryColor} 180deg, transparent 270deg)`,
            borderRadius: '50%',
            animation: 'spin 2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite',
            WebkitMaskImage: 'radial-gradient(circle, transparent 62px, black 66px)',
            maskImage: 'radial-gradient(circle, transparent 62px, black 66px)'
          }} />
          
          {/* Middle rotating ring */}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            width: '100px',
            height: '100px',
            border: `3px solid transparent`,
            borderBottomColor: secondaryColor,
            borderLeftColor: primaryColor,
            borderRadius: '50%',
            animation: 'spin-reverse 1.5s linear infinite',
            filter: `drop-shadow(0 0 8px ${secondaryColor}40)`
          }} />
          
          {/* Inner pulsing circle with better shadow */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '60px',
            height: '60px',
            background: `radial-gradient(circle, ${primaryColor}, ${secondaryColor})`,
            borderRadius: '50%',
            opacity: 0.5,
            animation: 'pulse-scale 2s ease-in-out infinite',
            boxShadow: `0 0 30px ${primaryColor}60, 0 0 60px ${secondaryColor}30`
          }} />
          
          {/* Center icon area with better styling */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '48px',
            height: '48px',
            backgroundColor: colors.white,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 4px 20px ${colors.border}60, inset 0 2px 4px ${colors.border}20`
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              border: `3px solid transparent`,
              borderTopColor: primaryColor,
              borderRightColor: secondaryColor,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          </div>

          {/* Orbiting dots */}
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '8px',
                height: '8px',
                backgroundColor: index % 2 === 0 ? primaryColor : secondaryColor,
                borderRadius: '50%',
                transformOrigin: '0 0',
                animation: `orbit 3s linear infinite`,
                animationDelay: `${index * -1}s`,
                boxShadow: `0 0 10px ${index % 2 === 0 ? primaryColor : secondaryColor}`
              }}
            />
          ))}
        </div>

        {/* Title with enhanced styling */}
        <div style={{
          textAlign: 'center',
          animation: 'fade-in-up 0.6s ease-out'
        }}>
          <h2 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: colors.text,
            margin: 0,
            marginBottom: '16px',
            background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
            textShadow: `0 2px 10px ${primaryColor}20`
          }}>
            {title}
          </h2>
          <p style={{
            fontSize: '16px',
            color: colors.textSecondary,
            margin: 0,
            lineHeight: '1.7',
            maxWidth: 'min(92vw, 640px)',
            fontWeight: '400'
          }}>
            {message}
          </p>
        </div>

        {/* Enhanced progress dots */}
        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center'
        }}>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              style={{
                width: '10px',
                height: '10px',
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                borderRadius: '50%',
                animation: `bounce-smooth 1.6s ease-in-out infinite`,
                animationDelay: `${index * 0.2}s`,
                boxShadow: `0 4px 12px ${primaryColor}40`
              }}
            />
          ))}
        </div>

        {/* Enhanced progress bar with shimmer effect */}
        <div style={{
          width: '320px',
          height: '6px',
          backgroundColor: `${colors.border}60`,
          borderRadius: '3px',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: `inset 0 1px 3px ${colors.border}40`
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: '45%',
            background: `linear-gradient(90deg, 
              transparent, 
              ${primaryColor}40, 
              ${primaryColor}, 
              ${secondaryColor}, 
              ${secondaryColor}40, 
              transparent)`,
            borderRadius: '3px',
            animation: 'progress-shimmer 2.5s ease-in-out infinite',
            boxShadow: `0 0 15px ${primaryColor}60`
          }} />
        </div>

        {/* Status indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          backgroundColor: `${primaryColor}08`,
          borderRadius: '20px',
          border: `1px solid ${primaryColor}20`,
          animation: 'fade-in 0.8s ease-out 0.3s backwards'
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            backgroundColor: primaryColor,
            borderRadius: '50%',
            animation: 'blink 1.5s ease-in-out infinite'
          }} />
          <span style={{
            fontSize: '13px',
            color: colors.textSecondary,
            fontWeight: '500',
            letterSpacing: '0.02em'
          }}>
            {isUpdate ? 'Processing update...' : 'Preparing export...'}
          </span>
        </div>
      </div>

      {/* Enhanced animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        
        @keyframes pulse-scale {
          0%, 100% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.5;
          }
          50% {
            transform: translate(-50%, -50%) scale(1.3);
            opacity: 0.2;
          }
        }
        
        @keyframes glow-pulse {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.1);
          }
        }
        
        @keyframes float-bg {
          0%, 100% {
            transform: translate(0, 0) scale(1);
            opacity: 0.3;
          }
          33% {
            transform: translate(2%, -2%) scale(1.05);
            opacity: 0.4;
          }
          66% {
            transform: translate(-2%, 2%) scale(0.95);
            opacity: 0.5;
          }
        }
        
        @keyframes float-particle {
          0%, 100% {
            transform: translate(0, 0);
            opacity: 0.2;
          }
          50% {
            transform: translate(10px, -20px);
            opacity: 0.4;
          }
        }
        
        @keyframes bounce-smooth {
          0%, 80%, 100% {
            transform: translateY(0) scale(1);
            opacity: 0.7;
          }
          40% {
            transform: translateY(-16px) scale(1.3);
            opacity: 1;
          }
        }
        
        @keyframes progress-shimmer {
          0% {
            transform: translateX(-100%);
          }
          50%, 100% {
            transform: translateX(400%);
          }
        }
        
        @keyframes orbit {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) translateX(70px);
          }
          100% {
            transform: translate(-50%, -50%) rotate(360deg) translateX(70px);
          }
        }
        
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
