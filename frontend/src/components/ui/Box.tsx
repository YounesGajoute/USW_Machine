import type { CSSProperties, ReactNode, HTMLAttributes } from 'react'
import { forwardRef, memo } from 'react'

export interface BoxProps extends Omit<HTMLAttributes<HTMLElement>, 'style'> {
  children?: ReactNode
  style?: CSSProperties
  className?: string
  as?: 'div' | 'span'
}

const Box = memo(forwardRef<HTMLElement, BoxProps>(({
  children,
  style,
  className,
  as: Component = 'div',
  ...rest
}, ref) => {
  return (
    <Component
      ref={ref as any}
      className={className}
      style={style}
      {...rest}
    >
      {children}
    </Component>
  )
}))

Box.displayName = 'Box'

export default Box
