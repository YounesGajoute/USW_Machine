import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_DLG_FORM_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'
import { mergeKioskTouchScrollClass, touchScrollable } from '@/lib/touchScrollable'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  )
}

export function DialogTrigger({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Trigger asChild>{children}</DialogPrimitive.Trigger>
}

/**
 * Kiosk-friendly: flex-centered shell (no translate(-50%)) so width: min() resolves
 * reliably; wrapper uses pointer-events: none so outside clicks hit the overlay.
 */
interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When true, children are rendered directly inside the flex-column panel
   * without an auto-scroll wrapper. Use this when the dialog manages its own
   * scrollable/sticky layout (e.g. form + pinned virtual keyboard).
   */
  noScrollWrap?: boolean
}

export function DialogContent({ children, style, className, noScrollWrap, ...props }: DialogContentProps) {
  const { colors } = useTheme()
  const padding = 'clamp(18px, 2.5vw, 32px)'
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
        }}
      />
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1001,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 'max(20px, env(safe-area-inset-top, 0px))',
          paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
          paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }}
      >
        <DialogPrimitive.Content
          className={mergeKioskTouchScrollClass(className)}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          style={{
            position: 'relative',
            pointerEvents: 'auto',
            margin: 0,
            marginTop: 'min(8vh, 64px)',
            backgroundColor: colors.white,
            borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
            width: KIOSK_DLG_FORM_W,
            maxWidth: '100%',
            maxHeight: KIOSK_DLG_MAX_H,
            boxSizing: 'border-box',
            overflow: 'hidden',
            flexShrink: 0,
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            ...style,
          }}
          {...props}
        >
          {noScrollWrap ? children : (
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding,
                boxSizing: 'border-box',
                ...touchScrollable,
              }}
            >
              {children}
            </div>
          )}
          <DialogPrimitive.Close
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              minWidth: '48px',
              minHeight: '48px',
              padding: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '10px',
              color: colors.text,
              touchAction: 'manipulation',
            }}
          >
            <X size={24} color="currentColor" strokeWidth={2.25} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  )
}

/** Scrollable form body inside a noScrollWrap dialog. Fills available space and scrolls. */
export function DialogScrollArea({ children, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px',
        boxSizing: 'border-box',
        ...touchScrollable,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

/** Sticky footer bar for action buttons inside a noScrollWrap dialog. */
export function DialogFooter({ children, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { colors } = useTheme()
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '10px',
        padding: '14px 24px',
        borderTop: `1px solid ${colors.border}`,
        backgroundColor: colors.white,
        boxSizing: 'border-box',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export function DialogHeader({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ marginBottom: '16px', paddingRight: '52px' }} {...props}>
      {children}
    </div>
  )
}

export function DialogTitle({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { colors } = useTheme()
  return (
    <DialogPrimitive.Title
      style={{ fontSize: '22px', fontWeight: 'bold', color: colors.text, lineHeight: 1.25 }}
      {...props}
    >
      {children}
    </DialogPrimitive.Title>
  )
}

export function DialogDescription({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { colors } = useTheme()
  return (
    <DialogPrimitive.Description
      style={{ fontSize: '15px', color: colors.textSecondary, marginTop: '8px', lineHeight: 1.45 }}
      {...props}
    >
      {children}
    </DialogPrimitive.Description>
  )
}
