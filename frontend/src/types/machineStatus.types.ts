/**
 * Legacy operational phases and UI visual families for {@link StatusControl} / {@link StatusBar}.
 * Prefer `LifecycleState` from `machineLifecycle.types.ts` for new backend wiring.
 */

export const MachineOperationalPhase = {
  INITIALIZATION: 'INITIALIZATION',
  IDLE_WAITING_TRIGGER: 'IDLE_WAITING_TRIGGER',
  CYCLE_PRE_OPERATION: 'CYCLE_PRE_OPERATION',
  EXECUTION: 'EXECUTION',
  END_COMPLETION: 'END_COMPLETION',
  POST_PROCESSING_UNLOADING: 'POST_PROCESSING_UNLOADING',
  CYCLE_END_RESET: 'CYCLE_END_RESET',
  RETURN_TO_IDLE: 'RETURN_TO_IDLE',
  FAULT: 'FAULT',
  E_STOP: 'E_STOP',
  ENERGY_SHUTDOWN: 'ENERGY_SHUTDOWN',
  REINITIALIZATION: 'REINITIALIZATION',
  STEP_BY_STEP_MODE: 'STEP_BY_STEP_MODE',
  SEQUENCE_MODE: 'SEQUENCE_MODE',
} as const

export type MachineOperationalPhase =
  (typeof MachineOperationalPhase)[keyof typeof MachineOperationalPhase]

export const MachineVisualState = {
  FAULT: 'FAULT',
  INITIALIZATION: 'INITIALIZATION',
  IDLE: 'IDLE',
  E_STOP: 'E_STOP',
  ENERGY_SHUTDOWN: 'ENERGY_SHUTDOWN',
  REINITIALIZATION: 'REINITIALIZATION',
  STEP_BY_STEP: 'STEP_BY_STEP',
  SEQUENCE: 'SEQUENCE',
} as const

export type MachineVisualState = (typeof MachineVisualState)[keyof typeof MachineVisualState]

export const PHASE_DEFAULT_TITLE: Record<MachineOperationalPhase, string> = {
  [MachineOperationalPhase.INITIALIZATION]: 'Initialization',
  [MachineOperationalPhase.IDLE_WAITING_TRIGGER]: 'Idle — waiting for trigger',
  [MachineOperationalPhase.CYCLE_PRE_OPERATION]: 'Cycle start / pre-operation',
  [MachineOperationalPhase.EXECUTION]: 'Execution / processing',
  [MachineOperationalPhase.END_COMPLETION]: 'End of operation',
  [MachineOperationalPhase.POST_PROCESSING_UNLOADING]: 'Post-processing / unloading',
  [MachineOperationalPhase.CYCLE_END_RESET]: 'Cycle end / reset',
  [MachineOperationalPhase.RETURN_TO_IDLE]: 'Return to idle',
  [MachineOperationalPhase.FAULT]: 'Fault / alarm',
  [MachineOperationalPhase.E_STOP]: 'E-stop',
  [MachineOperationalPhase.ENERGY_SHUTDOWN]: 'Energy shutdown',
  [MachineOperationalPhase.REINITIALIZATION]: 'Re-initialization',
  [MachineOperationalPhase.STEP_BY_STEP_MODE]: 'Step-by-step mode',
  [MachineOperationalPhase.SEQUENCE_MODE]: 'Sequence mode',
}

export const PHASE_DEFAULT_DETAIL: Record<MachineOperationalPhase, string> = {
  [MachineOperationalPhase.INITIALIZATION]:
    'Hardware checks, homing, loading parameters.',
  [MachineOperationalPhase.IDLE_WAITING_TRIGGER]:
    'Safety verified — waiting for Start or external signal.',
  [MachineOperationalPhase.CYCLE_PRE_OPERATION]:
    'Material, tool, and position checks; enabling actuators.',
  [MachineOperationalPhase.EXECUTION]:
    'Motion and process active — monitoring sensors and interlocks.',
  [MachineOperationalPhase.END_COMPLETION]:
    'Target reached — finalizing (e.g. spindle, heaters).',
  [MachineOperationalPhase.POST_PROCESSING_UNLOADING]:
    'Moving to unload, releasing part, tooling cleanup if needed.',
  [MachineOperationalPhase.CYCLE_END_RESET]:
    'Updating logs/counters, homing or standby for next cycle.',
  [MachineOperationalPhase.RETURN_TO_IDLE]: 'Ready for next trigger.',
  [MachineOperationalPhase.FAULT]: 'Safe stop — clear alarm or wait for recovery.',
  [MachineOperationalPhase.E_STOP]:
    'Emergency stop latched — reset E-stop when safe, then acknowledge.',
  [MachineOperationalPhase.ENERGY_SHUTDOWN]:
    'Machine energy is off or shutting down — wait for controlled power-up.',
  [MachineOperationalPhase.REINITIALIZATION]:
    'Re-running checks, homing, and configuration after recovery.',
  [MachineOperationalPhase.STEP_BY_STEP_MODE]:
    'One step at a time — confirm or trigger each step before continuing.',
  [MachineOperationalPhase.SEQUENCE_MODE]:
    'Running or following a programmed sequence of operations.',
}
