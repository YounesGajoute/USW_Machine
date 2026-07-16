import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyActiveFault, faultToErrorRecord, FAULT_CATEGORY, FAULT_CODE } from './faultClassifier.mjs'

test('healthy snapshot → no fault', () => {
  const fault = classifyActiveFault({
    connected: true,
    lastError: null,
    lifecycleState: 'IDLE',
  })
  assert.equal(fault, null)
})

test('safety lockout → SAFETY with root-cause codes', () => {
  const fault = classifyActiveFault({
    connected: true,
    isSafetyLockout: true,
    safetyRootCause: { codes: ['DOOR_RIGHT_1', 'DOOR_RIGHT_2'], primary: 'DOOR_RIGHT_1' },
    lastError: 'Emergency: Right-side door 1 + Right-side door 2',
  })
  assert.equal(fault.category, FAULT_CATEGORY.SAFETY)
  assert.deepEqual(fault.codes, ['DOOR_RIGHT_1', 'DOOR_RIGHT_2'])
  assert.equal(fault.primary, 'DOOR_RIGHT_1')
})

test('emergency stop with no doors open → EMERGENCY_STOP', () => {
  const fault = classifyActiveFault({
    connected: true,
    isSafetyLockout: true,
    safetyRootCause: { codes: ['EMERGENCY_STOP'], primary: 'EMERGENCY_STOP' },
  })
  assert.equal(fault.category, FAULT_CATEGORY.SAFETY)
  assert.equal(fault.primary, FAULT_CODE.EMERGENCY_STOP)
})

test('lockout without safetyRootCause but door message → DOOR_RIGHT_2', () => {
  const fault = classifyActiveFault({
    connected: true,
    isSafetyLockout: true,
    lastError: 'Emergency: Right-side door 2',
  })
  assert.equal(fault.category, FAULT_CATEGORY.SAFETY)
  assert.equal(fault.primary, FAULT_CODE.DOOR_RIGHT_2)
  assert.deepEqual(fault.codes, [FAULT_CODE.DOOR_RIGHT_2])
})

test('stale safetyRootCause after recover (not locked out) → no fault', () => {
  const fault = classifyActiveFault({
    connected: true,
    isSafetyLockout: false,
    lifecycleState: 'IDLE',
    safetyRootCause: { codes: ['EMERGENCY_STOP'], primary: 'EMERGENCY_STOP' },
    lastError: null,
  })
  assert.equal(fault, null)
})

test('disconnected → CONNECTIVITY / ETHERCAT_DISCONNECTED', () => {
  const fault = classifyActiveFault({ connected: false })
  assert.equal(fault.category, FAULT_CATEGORY.CONNECTIVITY)
  assert.equal(fault.primary, FAULT_CODE.ETHERCAT_DISCONNECTED)
})

test('PNOZ feedback timeout in INIT → PNOZ_FEEDBACK_TIMEOUT', () => {
  const fault = classifyActiveFault({
    connected: true,
    lifecycleState: 'INIT',
    lastError: 'PNOZ X2.8P feedback (DI3) not confirmed within 5000 ms',
  })
  assert.equal(fault.category, FAULT_CATEGORY.INIT)
  assert.equal(fault.primary, FAULT_CODE.PNOZ_FEEDBACK_TIMEOUT)
})

test('vision failure during production → VISION_FAIL', () => {
  const fault = classifyActiveFault({
    connected: true,
    lifecycleState: 'IDLE',
    productionPhase: 'error',
    lastError: 'Vision welding_splice failed — contour mismatch',
  })
  assert.equal(fault.category, FAULT_CATEGORY.PRODUCTION)
  assert.equal(fault.primary, FAULT_CODE.VISION_FAIL)
})

test('pick & place homing in INIT vs move in production', () => {
  const initFault = classifyActiveFault({
    connected: true,
    lifecycleState: 'INIT',
    lastError: 'Pick & Place HOMEA failed',
  })
  assert.equal(initFault.primary, FAULT_CODE.PICK_PLACE_HOMING)

  const prodFault = classifyActiveFault({
    connected: true,
    lifecycleState: 'IDLE',
    lastError: 'MOVEAMMT2 move failed',
  })
  assert.equal(prodFault.primary, FAULT_CODE.PICK_PLACE_MOVE)
})

test('centring TCP HOME/SEEK errors are CENTRING_INIT — not pick & place', () => {
  for (const lastError of [
    'HOME failed: upper not homed — check UH (D3) / mechanics',
    'SEEK_TRAVEL ended early: moveEnd=home_fail',
    'HOME_UPPER failed: still busy after completion',
    'home blocked: motion in progress',
  ]) {
    const initFault = classifyActiveFault({
      connected: true,
      lifecycleState: 'INIT',
      lastError,
    })
    assert.equal(
      initFault.primary,
      FAULT_CODE.CENTRING_INIT,
      `expected CENTRING_INIT for: ${lastError}`,
    )
    assert.notEqual(initFault.primary, FAULT_CODE.PICK_PLACE_HOMING)

    // After failInit the HMI polls with lifecycle ERROR — still centring init, not P&P move
    const afterError = classifyActiveFault({
      connected: true,
      lifecycleState: 'ERROR',
      lastError,
    })
    assert.equal(
      afterError.primary,
      FAULT_CODE.CENTRING_INIT,
      `expected CENTRING_INIT while ERROR for: ${lastError}`,
    )
    assert.equal(afterError.category, FAULT_CATEGORY.INIT)
  }
})

test('Centring-prefixed cycle message stays CENTRING_CYCLE outside INIT', () => {
  const fault = classifyActiveFault({
    connected: true,
    lifecycleState: 'RUN',
    lastError: 'Centring travel: unexpected moveEnd=ok after MOVE',
  })
  assert.equal(fault.primary, FAULT_CODE.CENTRING_CYCLE)
  assert.equal(fault.category, FAULT_CATEGORY.PRODUCTION)
})

test('unmatched error falls back to generic by lifecycle', () => {
  const initFault = classifyActiveFault({
    connected: true,
    lifecycleState: 'INIT',
    lastError: 'Something odd happened',
  })
  assert.equal(initFault.primary, FAULT_CODE.INIT_GENERIC)

  const prodFault = classifyActiveFault({
    connected: true,
    lifecycleState: 'IDLE',
    lastError: 'Something odd happened',
  })
  assert.equal(prodFault.primary, FAULT_CODE.PRODUCTION_GENERIC)
})

test('setup-pending / door-to-initialize gating is not a production fault', () => {
  assert.equal(
    classifyActiveFault({
      connected: true,
      lifecycleState: 'ERROR',
      lastError: 'EtherCAT connected — run Setup',
    }),
    null,
  )
  assert.equal(
    classifyActiveFault({
      connected: true,
      lifecycleState: 'ERROR',
      lastError: 'Close the right-side door(s) to initialize',
    }),
    null,
  )
  assert.equal(
    classifyActiveFault({
      connected: true,
      lifecycleState: 'ERROR',
      lastError: 'Close the back door to initialize',
    }),
    null,
  )
})

test('stale Emergency door latch after lockout exit is not a production fault', () => {
  assert.equal(
    classifyActiveFault({
      connected: true,
      isSafetyLockout: false,
      lifecycleState: 'POWER_OFF',
      lastError: 'Emergency: Right-side door 1',
    }),
    null,
  )
})

test('faultToErrorRecord: null fault → null', () => {
  assert.equal(faultToErrorRecord(null), null)
})

test('faultToErrorRecord: safety lockout → critical / safety_lockout with codes', () => {
  const fault = classifyActiveFault({
    isSafetyLockout: true,
    safetyRootCause: { codes: ['DOOR_RIGHT_1', 'DOOR_RIGHT_2'], primary: 'DOOR_RIGHT_1' },
    lastError: 'Emergency: Right door 1, Right door 2',
  })
  const rec = faultToErrorRecord(fault)
  assert.equal(rec.errorCode, FAULT_CODE.DOOR_RIGHT_1)
  assert.equal(rec.severity, 'critical')
  assert.equal(rec.phase, 'safety_lockout')
  assert.deepEqual(rec.context.codes, ['DOOR_RIGHT_1', 'DOOR_RIGHT_2'])
  assert.equal(rec.context.category, FAULT_CATEGORY.SAFETY)
})

test('faultToErrorRecord: init failure → high / initialization', () => {
  const fault = classifyActiveFault({
    connected: true,
    lifecycleState: 'INIT',
    lastError: 'PNOZ X2.8P feedback (DI3) not confirmed within 5000 ms',
  })
  const rec = faultToErrorRecord(fault)
  assert.equal(rec.errorCode, FAULT_CODE.PNOZ_FEEDBACK_TIMEOUT)
  assert.equal(rec.severity, 'high')
  assert.equal(rec.phase, 'initialization')
})

test('faultToErrorRecord: connectivity → critical / connectivity', () => {
  const rec = faultToErrorRecord(classifyActiveFault({ connected: false }))
  assert.equal(rec.errorCode, FAULT_CODE.ETHERCAT_DISCONNECTED)
  assert.equal(rec.severity, 'critical')
  assert.equal(rec.phase, 'connectivity')
})

test('faultToErrorRecord: production VISION_FAIL → high / production', () => {
  const fault = classifyActiveFault({
    connected: true,
    lifecycleState: 'CYCLE_START',
    lastError: 'Vision inspection failed',
  })
  const rec = faultToErrorRecord(fault)
  assert.equal(rec.errorCode, FAULT_CODE.VISION_FAIL)
  assert.equal(rec.severity, 'high')
  assert.equal(rec.phase, 'production')
})

test('connectivity block — centring unreachable', () => {
  const fault = classifyActiveFault({
    connected: true,
    connectivity: {
      ethercat: { reachable: true },
      vision: { reachable: true },
      pickPlace: { reachable: true },
      centring: { reachable: false, lastError: 'timeout' },
    },
  })
  assert.equal(fault.category, FAULT_CATEGORY.CONNECTIVITY)
  assert.equal(fault.primary, FAULT_CODE.CENTRING_UNREACHABLE)
})
