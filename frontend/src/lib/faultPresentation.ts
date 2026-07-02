import type { ActiveFault, FaultCode, FaultCategory } from '@/services/machineInitApi'
import type { GeneralCopy } from '@/i18n/generalSettings'

/**
 * Presentation mapping for each fault code: a component / fault picture and the
 * localized copy keys. Real diagrams/photos can be dropped in at the same paths
 * under `frontend/public/images/errors/`.
 */
interface FaultPresentation {
  /** Path under public/ to the picture. */
  image: string
  /** General-copy key for the short label. */
  labelKey: keyof GeneralCopy
  /** General-copy key for the operator-facing short description / recovery hint. */
  descKey: keyof GeneralCopy
}

const FAULT_PRESENTATION: Record<FaultCode, FaultPresentation> = {
  // Safety
  EMERGENCY_STOP: {
    image: '/images/errors/emergency-stop.png',
    labelKey: 'emergencyCauseEmergencyStop',
    descKey: 'emergencyDescEmergencyStop',
  },
  DOOR_RIGHT_1: {
    image: '/images/errors/door-right-1.png',
    labelKey: 'emergencyCauseDoorRight1',
    descKey: 'emergencyDescDoorRight1',
  },
  DOOR_RIGHT_2: {
    image: '/images/errors/door-right-2.png',
    labelKey: 'emergencyCauseDoorRight2',
    descKey: 'emergencyDescDoorRight2',
  },
  DOOR_BACK: {
    image: '/images/errors/door-back.png',
    labelKey: 'emergencyCauseDoorBack',
    descKey: 'emergencyDescDoorBack',
  },
  // Connectivity
  ETHERCAT_DISCONNECTED: {
    image: '/images/errors/ethercat-disconnected.png',
    labelKey: 'faultLabelEthercat',
    descKey: 'faultDescEthercat',
  },
  // Initialization
  PNOZ_FEEDBACK_TIMEOUT: {
    image: '/images/errors/pnoz-feedback.png',
    labelKey: 'faultLabelPnoz',
    descKey: 'faultDescPnoz',
  },
  PICK_PLACE_HOMING: {
    image: '/images/errors/pick-place-homing.png',
    labelKey: 'faultLabelPickPlaceHoming',
    descKey: 'faultDescPickPlaceHoming',
  },
  CENTRING_INIT: {
    image: '/images/errors/centring-init.png',
    labelKey: 'faultLabelCentringInit',
    descKey: 'faultDescCentringInit',
  },
  INIT_BUTTON_NOT_PRESSED: {
    image: '/images/errors/init-button.png',
    labelKey: 'faultLabelInitButton',
    descKey: 'faultDescInitButton',
  },
  INIT_GENERIC: {
    image: '/images/errors/init-fault.png',
    labelKey: 'faultLabelInitGeneric',
    descKey: 'faultDescInitGeneric',
  },
  // Production
  VISION_FAIL: {
    image: '/images/errors/vision-fail.png',
    labelKey: 'faultLabelVision',
    descKey: 'faultDescVision',
  },
  PNEUMATIC_FAULT: {
    image: '/images/errors/pneumatics.png',
    labelKey: 'faultLabelPneumatic',
    descKey: 'faultDescPneumatic',
  },
  PICK_PLACE_MOVE: {
    image: '/images/errors/pick-place-move.png',
    labelKey: 'faultLabelPickPlaceMove',
    descKey: 'faultDescPickPlaceMove',
  },
  CENTRING_CYCLE: {
    image: '/images/errors/centring-cycle.png',
    labelKey: 'faultLabelCentringCycle',
    descKey: 'faultDescCentringCycle',
  },
  START_BUTTON_NOT_PRESSED: {
    image: '/images/errors/start-button.png',
    labelKey: 'faultLabelStartButton',
    descKey: 'faultDescStartButton',
  },
  SHRINK_TUBE_INVALID: {
    image: '/images/errors/shrink-tube.png',
    labelKey: 'faultLabelShrinkTube',
    descKey: 'faultDescShrinkTube',
  },
  PRODUCTION_GENERIC: {
    image: '/images/errors/production-fault.png',
    labelKey: 'faultLabelProductionGeneric',
    descKey: 'faultDescProductionGeneric',
  },
}

const CATEGORY_TITLE_KEY: Record<FaultCategory, keyof GeneralCopy> = {
  SAFETY: 'faultTitleSafety',
  CONNECTIVITY: 'faultTitleConnectivity',
  INIT: 'faultTitleInit',
  PRODUCTION: 'faultTitleProduction',
}

export interface ResolvedFault {
  code: FaultCode
  image: string
  label: string
  description: string
}

/** Resolve a fault code into its picture + localized label/description. */
export function resolveFault(code: FaultCode, general: GeneralCopy): ResolvedFault {
  const p = FAULT_PRESENTATION[code]
  if (!p) {
    return { code, image: '/images/errors/production-fault.png', label: code, description: '' }
  }
  return {
    code,
    image: p.image,
    label: general[p.labelKey],
    description: general[p.descKey],
  }
}

/** Localized title for a fault category (used in both cards). */
export function faultCategoryTitle(category: FaultCategory, general: GeneralCopy): string {
  return general[CATEGORY_TITLE_KEY[category]] ?? general.emergencyTitle
}

/**
 * Shared predicate for "a fault is active and presentable". Drives the MainPage
 * status panel's failure state (a non-empty `codes` array with a `primary` code).
 */
export function isActiveFault(fault: ActiveFault | null | undefined): fault is ActiveFault {
  return !!fault && Array.isArray(fault.codes) && fault.codes.length > 0 && !!fault.primary
}
