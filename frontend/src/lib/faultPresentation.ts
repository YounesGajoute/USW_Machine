import type { ActiveFault, FaultCode, FaultCategory } from '@/services/machineInitApi'
import type { GeneralCopy } from '@/i18n/generalSettings'
import type { InitPrecondition } from '@/hooks/useMachineInitialization'

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
  VISION_UNREACHABLE: {
    image: '/images/errors/vision-unreachable.png',
    labelKey: 'faultLabelVisionUnreachable',
    descKey: 'faultDescVisionUnreachable',
  },
  PICK_PLACE_UNREACHABLE: {
    image: '/images/errors/pick-place-unreachable.png',
    labelKey: 'faultLabelPickPlaceUnreachable',
    descKey: 'faultDescPickPlaceUnreachable',
  },
  CENTRING_UNREACHABLE: {
    image: '/images/errors/centring-unreachable.png',
    labelKey: 'faultLabelCentringUnreachable',
    descKey: 'faultDescCentringUnreachable',
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
    image: '/images/errors/centring-unreachable.png',
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
    image: '/images/errors/centring-unreachable.png',
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
    // Never surface a raw fault code to the operator — fall back to a plain,
    // human-readable generic fault message.
    return {
      code,
      image: '/images/errors/production-fault.png',
      label: general.faultLabelProductionGeneric,
      description: general.faultDescProductionGeneric,
    }
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

/** A single unmet condition / active fault to browse in the main canvas. */
export interface ConditionIssue {
  /** Stable key (fault code or synthetic precondition key). */
  key: string
  image: string
  /** Short title shown above the image and in the list. */
  label: string
  /** Operator-facing explanation / recovery hint. */
  description: string
}

/** Start-up precondition id → the fault code that shares its picture + copy. */
const PRECONDITION_FAULT_CODE: Record<InitPrecondition['id'], FaultCode | null> = {
  doorRight1: 'DOOR_RIGHT_1',
  doorRight2: 'DOOR_RIGHT_2',
  doorBack: 'DOOR_BACK',
  airPressure: null,
  emergency: 'EMERGENCY_STOP',
}

/**
 * Merge the active-fault causes and the failed start-up preconditions into a
 * single, de-duplicated list of unmet conditions (each with a picture + copy).
 * Active faults lead (primary first); failed preconditions follow. This is the
 * source of truth for the interactive "conditions to start the machine" browser.
 */
export function buildUnmetConditions(
  fault: ActiveFault | null | undefined,
  preconditions: InitPrecondition[] | null | undefined,
  general: GeneralCopy,
): ConditionIssue[] {
  const out: ConditionIssue[] = []
  const seen = new Set<string>()
  const push = (issue: ConditionIssue) => {
    if (seen.has(issue.key)) return
    seen.add(issue.key)
    out.push(issue)
  }

  if (isActiveFault(fault)) {
    const ordered = [fault.primary, ...fault.codes.filter((c) => c !== fault.primary)]
    for (const code of ordered) {
      const r = resolveFault(code, general)
      push({ key: r.code, image: r.image, label: r.label, description: r.description })
    }
  }

  for (const p of preconditions ?? []) {
    if (p.ok) continue
    const code = PRECONDITION_FAULT_CODE[p.id]
    if (code) {
      const r = resolveFault(code, general)
      push({ key: r.code, image: r.image, label: r.label, description: r.description })
    } else if (p.id === 'airPressure') {
      push({
        key: 'AIR_PRESSURE',
        image: '/images/errors/pneumatics.png',
        label: general.faultLabelPneumatic,
        description: general.faultDescPneumatic,
      })
    }
  }

  return out
}
