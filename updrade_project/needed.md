# Machine Control Layers — Needed Model

Industrial machines separate concerns into stacked layers. PackML alone is not enough.

| Layer | Role |
|-------|------|
| PackML Modes | Defines how the machine is allowed to operate |
| Lifecycle FSM | Defines the overall machine lifecycle from power-up to shutdown |
| PackML State Machine | Defines the production execution behavior |
| Operator Milestones | Defines the operator's workflow and business events |

**Rule:** Modes = permitted operation. Lifecycle = readiness from power-up to shutdown. PackML states = cycle execution. Operator milestones = workflow and business events. They must not be collapsed into one state list.

---

## 1. PackML Modes

Defines how the machine is allowed to operate. Modes do not replace lifecycle or PackML execution states.

| Mode | Purpose |
|------|---------|
| Production | Normal automatic cycles |
| Step-by-step | One cycle (or step) per operator request |
| Setup | Init / recover / changeover |
| Manual | Manual control of actuators (jog, teach) |
| Maintenance | Maintenance and repair activities |
| Service | OEM diagnostics |

**Gates:** Automatic continuous Start only in Production when lifecycle is ready. Step-by-step allows Start for a single cycle/step, then returns to Idle. Setup, Manual, Maintenance, and Service block automatic Start.

---

## 2. Lifecycle FSM

Defines the overall machine lifecycle from power-up to shutdown. PackML runs only while lifecycle is `RUNNING` (or equivalent ready-for-production path).

| State | Description |
|-------|-------------|
| OFF | Machine not powered |
| BOOTING | Operating system and runtime startup |
| INITIALIZING | Initialize hardware and software |
| VERIFYING | Verify machine readiness |
| READY | Machine available for operation |
| RUNNING | PackML controls production |
| RECOVERING | Recover after faults |
| MAINTENANCE | Maintenance mode |
| SHUTTING_DOWN | Graceful shutdown |
| ERROR | Fatal system error |

---

## 3. PackML State Machine

Defines the production execution behavior (ISA-TR88 / PackML subset).

| State |
|-------|
| Idle |
| Starting |
| Execute |
| Complete |
| Stopping |
| Aborting |
| Clearing |
| Stopped |
| Resetting |
| Suspended |

### Typical production path

```
Stopped
  → Resetting
  → Idle
  → Starting
  → Execute
  → Completing
  → Complete
  → Stopped
```

---

## 4. Operator Milestones

Defines the operator's workflow and business events. PackML does not define operator workflow; industrial systems add milestones above the PackML state machine.

### Level 1 — Machine Preparation

```
Machine Power ON
  → Controller Boot Complete
  → Safety System Ready
  → Communication Ready
  → Machine Initialized
  → Machine Available
```

### Level 2 — Operator Login

```
Operator Login
  → Role Verified
  → Recipe Loaded
  → Machine Ready
```

### Level 3 — Production Start

```
Operator Presses START
  → PackML Starting
  → Execute
  → Production Running
```

### Level 4 — Production Events

During Execute:

- Cycle Complete
- Good Part
- Reject Part
- Operator Pause

### Level 5 — Planned Stop

```
Stop Requested
  → Current Cycle Finished
  → PackML Completing
  → Production Complete
  → Machine Idle
```

### Level 6 — Fault Recovery

```
Alarm Raised
  → Production Interrupted
  → Fault Diagnosed
  → Fault Cleared
  → Reset Requested
  → Machine Initialized
  → Resume Production
```

### Level 7 — End of Production

```
Production Order Finished
  → Operator Logout
  → Power Down
```
