/**
 * Type-safe enums aligned with splice-py (https://github.com/splice-cad/splice-py).
 * @see splice-py splice/enums.py
 */

export const WireColor = {
  BLACK: 'black',
  WHITE: 'white',
  RED: 'red',
  GREEN: 'green',
  BLUE: 'blue',
  YELLOW: 'yellow',
  ORANGE: 'orange',
  BROWN: 'brown',
  PURPLE: 'purple',
  GRAY: 'gray',
  PINK: 'pink',
  VIOLET: 'violet',
  TAN: 'tan',
  NATURAL: 'natural',
  CLEAR: 'clear',
} as const

export type WireColor = (typeof WireColor)[keyof typeof WireColor]

export const ConductorType = {
  SOLID: 'solid',
  STRANDED: 'stranded',
} as const

export type ConductorType = (typeof ConductorType)[keyof typeof ConductorType]

export const Stranding = {
  SOLID: 'solid',
  CLASS_5: 'Class 5',
  AWG_22_7_30: '7/30',
  AWG_20_7_28: '7/28',
  AWG_18_16_30: '16/30',
} as const

export type Stranding = (typeof Stranding)[keyof typeof Stranding]

export const FlyingLeadType = {
  BARE: 'bare',
  TINNED: 'tinned',
  HEAT_SHRINK: 'heat_shrink',
} as const

export type FlyingLeadType = (typeof FlyingLeadType)[keyof typeof FlyingLeadType]

export const ConnectionSide = {
  LEFT: 'left',
  RIGHT: 'right',
} as const

export type ConnectionSide = (typeof ConnectionSide)[keyof typeof ConnectionSide]

export const TerminationType = {
  CONNECTOR_PIN: 'connector_pin',
  CABLE_CORE: 'cable_core',
  FLYING_LEAD: 'flying_lead',
} as const

export type TerminationType = (typeof TerminationType)[keyof typeof TerminationType]
