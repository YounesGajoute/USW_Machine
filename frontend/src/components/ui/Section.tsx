import { ReactNode } from 'react'

interface SectionProps {
  children: ReactNode
  style?: React.CSSProperties
  className?: string
}

export function Section({ children, style, className }: SectionProps) {
  return (
    <div
      style={{ marginBottom: '20px', ...style }}
      className={className}
    >
      {children}
    </div>
  )
}
