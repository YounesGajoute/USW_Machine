# Generic Architecture for a Modern Industrial Production Machine

**Document type:** Reference architecture  
**Audience:** Controls engineers, software architects, HMI designers, OEM service  
**Standards alignment:** ISA-TR88.00.02 (PackML), ISA-88 concepts, Industry 4.0 practices  
**Related project docs:** [LIFECYCLE_AND_JOB_QUEUE.md](./LIFECYCLE_AND_JOB_QUEUE.md), [LIFECYCLE_FSM_REDESIGN.md](./LIFECYCLE_FSM_REDESIGN.md)

---

## Purpose

For a modern industrial production machine, the architecture is most robust when it is divided into **four layers**, each with a distinct responsibility:

| Layer | Responsibility |
|-------|----------------|
| **PackML Modes** | Defines how the machine is allowed to operate |
| **Lifecycle FSM** | Defines the overall machine lifecycle from power-up to shutdown |
| **PackML State Machine** | Defines production execution behavior |
| **Operator Milestones** | Defines the operator workflow and business events |

This separation keeps the software modular, easier to validate, and aligned with ISA-88/PackML while supporting Industry 4.0 features.

```
                 +---------------------------+
                 |      PackML Modes         |
                 | Production / Setup / ...  |
                 +-------------+-------------+
                               │
                               ▼
                 +---------------------------+
                 |     Lifecycle FSM         |
                 | OFF                       |
                 | BOOTING                   |
                 | INITIALIZING              |
                 | VERIFYING                 |
                 | READY                     |
                 | RUNNING                   |
                 | RECOVERING                |
                 | MAINTENANCE               |
                 | SHUTTING_DOWN             |
                 | ERROR                     |
                 +-------------+-------------+
                               │
                               ▼
                 +---------------------------+
                 |    PackML State Machine   |
                 | Resetting                 |
                 | Idle                      |
                 | Starting                  |
                 | Execute                   |
                 | Holding                   |
                 | Completing                |
                 | Complete                  |
                 | Stopping                  |
                 | Aborting                  |
                 | Clearing                  |
                 +-------------+-------------+
                               │
                               ▼
                 +---------------------------+
                 |   Operator Milestones     |
                 | Login                     |
                 | Production Order          |
                 | Recipe                    |
                 | First Good Part           |
                 | Batch Complete            |
                 | Reports                   |
                 | Logout                    |
                 +---------------------------+
```

---

## 1. PackML Modes (ISA-TR88.00.02)

These define the **operational context** of the machine — what class of operation is permitted.

| Mode | Purpose | Typical User |
|------|---------|--------------|
| Production | Normal automatic production | Operator |
| Maintenance | Maintenance and repair activities | Maintenance Technician |
| Manual | Manual control of actuators for setup | Technician |
| Semi-Automatic | One cycle per operator request | Operator |
| Setup | Product changeover, teaching, calibration | Process Engineer |
| Cleaning | Cleaning process | Operator |
| Engineering | Debugging and commissioning | Engineer |
| Service | OEM diagnostics | OEM Service |
| Simulation | Run software without hardware | Developer |

### Typical production machine subset

A production machine generally uses only a subset:

- **Production**
- **Setup**
- **Manual**
- **Maintenance**
- **Service**

Optional modes for advanced platforms:

- Engineering
- Simulation
- Cleaning
- Semi-Automatic

### Design rule

Modes determine **what type of operation is permitted**. They do not replace lifecycle readiness or PackML execution states.

---

## 2. Lifecycle FSM (Machine Lifecycle)

The Lifecycle FSM manages the **entire machine lifecycle**, independent of PackML. It owns boot, hardware initialization, communication, safety, recovery, shutdown, and mode management.

It is active regardless of whether production is running.

### Lifecycle states

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

### Initialization responsibilities

During **INITIALIZING**:

- Load configuration
- Load recipes
- Initialize GPIO
- Initialize EtherCAT
- Initialize Modbus
- Initialize cameras
- Initialize vision engine
- Initialize robot
- Initialize PLC communication
- Initialize database
- Initialize HMI
- Initialize logging
- Initialize network
- Initialize MES connection
- Initialize MQTT
- Initialize OPC UA
- Initialize safety monitoring

### Verification responsibilities

During **VERIFYING**:

- Safety relay healthy
- Emergency stop released
- Safety doors closed
- EtherCAT operational
- PLC online
- Vision online
- Robot ready
- I/O healthy
- Air pressure OK
- Vacuum OK
- Servo ready
- Homing completed
- Recipe valid
- Production order loaded

If every check succeeds:

```
VERIFYING
      ↓
READY
```

Otherwise:

```
VERIFYING
      ↓
ERROR
```

### Lifecycle diagram

```
OFF
 │
 ▼
BOOTING
 │
 ▼
INITIALIZING
 │
 ▼
VERIFYING
 │
 ├──────────────┐
 ▼              │
READY           │
 │              │
 ▼              │
RUNNING         │
 │              │
 ├──────► RECOVERING
 │              │
 │              ▼
 └────────── READY
 │
 ▼
SHUTTING_DOWN
 │
 ▼
OFF
```

`MAINTENANCE` and `ERROR` are orthogonal resting contexts entered from readiness or fault paths; both return to `READY` (or `OFF` via shutdown) only after explicit recovery or mode exit.

### Design rule

The Lifecycle FSM manages **system readiness, infrastructure, recovery, and shutdown**. PackML becomes active only when the lifecycle enters **RUNNING**.

---

## 3. PackML State Machine

When the Lifecycle FSM enters **RUNNING**, the PackML State Machine becomes active and owns production execution behavior.

### Standard PackML states (17)

| State | Purpose |
|-------|---------|
| Stopped | Machine stopped |
| Resetting | Reset machine |
| Idle | Ready to start |
| Starting | Preparing production |
| Execute | Production running |
| Completing | Finish current batch |
| Complete | Batch completed |
| Holding | Controlled pause |
| Held | Paused |
| Unholding | Resume from hold |
| Suspending | External pause |
| Suspended | Suspended |
| Unsuspending | Resume after suspend |
| Stopping | Controlled stop |
| Aborting | Emergency / abort stop |
| Aborted | Machine aborted |
| Clearing | Recover from abort |

### Typical production path

```
Stopped
    ↓
Resetting
    ↓
Idle
    ↓
Starting
    ↓
Execute
    ↓
Completing
    ↓
Complete
    ↓
Stopping
    ↓
Stopped
```

### Design rule

PackML manages **only the production execution sequence** once the machine is ready. It does not own boot, fieldbus bring-up, MES connectivity, or operator login.

---

## 4. Operator Milestones

PackML does not define operator workflow. Industrial systems usually add **milestones above** the PackML state machine.

These are **business and operational events**, not controller states. They support traceability, OEE, MES integration, and audit logs, but **never drive the controller state machine directly**.

### Level 1 — Machine preparation

```
Machine Power ON
        ↓
Controller Boot Complete
        ↓
Safety System Ready
        ↓
Communication Ready
        ↓
Machine Initialized
        ↓
Machine Available
```

### Level 2 — Operator login / preparation

```
Operator Login
        ↓
Role Verified
        ↓
Shift Selected
        ↓
Production Order Selected
        ↓
Recipe Loaded
        ↓
Tools / Tooling Verified
        ↓
Material Available / Verified
        ↓
Machine Ready
```

### Level 3 — Production start

```
Operator Presses START
        ↓
PackML Starting
        ↓
Execute
        ↓
First Good Part
        ↓
Production Running
```

### Level 4 — Production events

During **Execute**:

- Cycle Complete
- Good Part
- Reject Part
- Material Low
- Material Empty
- Tool Life Warning
- Maintenance Reminder
- Operator Pause / Hold
- Quality Check / Inspection Required
- Shift Change

### Level 5 — Planned stop

```
Stop Requested
        ↓
Current Cycle Finished
        ↓
PackML Completing
        ↓
Production Complete
        ↓
Machine Idle
```

### Level 6 — Fault recovery

```
Alarm Raised
        ↓
Production Interrupted / Machine Stopped
        ↓
Fault Diagnosed
        ↓
Fault Cleared
        ↓
Reset Requested
        ↓
Lifecycle Recovering
        ↓
Verification
        ↓
Machine Initialized / Ready
        ↓
Resume Production
```

### Level 7 — End of production

```
Production Order Finished
        ↓
Generate Report
        ↓
Save / Store Statistics
        ↓
Archive Traceability
        ↓
Operator Logout
        ↓
Power Down / Shutdown
```

---

## 5. Example Complete Lifecycle

End-to-end operator and machine path combining all four layers:

```
Power ON
    │
    ▼
Boot
    │
    ▼
Safety Ready
    │
    ▼
Communications Ready
    │
    ▼
Initialization
    │
    ▼
Idle / Ready
    │
    ▼
Operator Login
    │
    ▼
Load Production Order
    │
    ▼
Load Recipe
    │
    ▼
Verify Tooling
    │
    ▼
Verify Material
    │
    ▼
Ready to Produce
    │
    ▼
START
    │
    ▼
Starting
    │
    ▼
Execute
    │
    ├── Good Parts
    ├── Reject Parts
    ├── Quality Checks
    ├── Operator Hold
    ├── Material Refill
    └── Maintenance
    │
    ▼
Production Complete
    │
    ▼
Generate Reports
    │
    ▼
Idle
    │
    ▼
Shutdown
```

---

## 6. Recommended Industry 4.0 Milestones

Beyond the PackML standard, modern production systems commonly track additional checkpoints. These complement PackML by representing operational and business events **without adding unnecessary states** to the controller lifecycle.

| Milestone | Intent |
|-----------|--------|
| System Health Verified | PLC, IPC, sensors, cameras, fieldbus |
| EtherCAT / Fieldbus Operational | Fieldbus healthy |
| Vision System Ready | Cameras / vision engine ready |
| Robot Ready | Robot controller ready |
| Safety Circuit Healthy | Safety relay / interlocks OK |
| Calibration Verified | Process calibration current |
| Recipe Validation Passed | Recipe schema and limits OK |
| Traceability Connected | MES / ERP link up |
| Batch Started | Business batch open |
| Batch Completed | Business batch closed |
| OEE Data Collection Started | Performance metrics active |
| Preventive Maintenance Due | PM window approaching |
| Maintenance Completed | PM closed |
| Audit Trail Recorded | Critical change logged |
| Machine Locked | Maintenance or safety lockout |
| Machine Unlocked | Lockout cleared |

This separation keeps control logic aligned with PackML while providing the traceability and workflow visibility expected in Industry 4.0 systems.

---

## 7. Design Principles

1. **Modes** determine what type of operation is permitted.
2. **Lifecycle FSM** manages system readiness, infrastructure, recovery, and shutdown. It remains active whether or not production is running.
3. **PackML** manages only the production execution sequence once the machine is ready (lifecycle **RUNNING**).
4. **Operator Milestones** capture human actions and business events for traceability, OEE, MES integration, and audit logs — they never drive the controller state machine directly.

### Why four layers

| Concern | Wrong place | Correct place |
|---------|-------------|---------------|
| Boot / EtherCAT / safety bring-up | PackML states | Lifecycle FSM |
| Automatic production sequence | Lifecycle states | PackML |
| Login / recipe / order selection | Controller FSM | Operator milestones |
| Maintenance vs production permission | PackML states alone | PackML modes (+ lifecycle gate) |

---

## 8. Mapping Guidance (Project Implementation)

This document is the **generic reference**. Project-specific state names and wire codes may differ while preserving the same layer split.

| Generic layer | Typical project mapping |
|---------------|-------------------------|
| PackML Modes | Mode / permission context (Production, Setup, Manual, Maintenance, Service) |
| Lifecycle FSM | Backend machine lifecycle module (boot → ready → run → recover → shutdown) |
| PackML State Machine | Production execution / job cycle phases once lifecycle is RUNNING / ready |
| Operator Milestones | HMI workflow, audit events, MES hooks, OEE counters |

See also:

- [LIFECYCLE_AND_JOB_QUEUE.md](./LIFECYCLE_AND_JOB_QUEUE.md) — current machine lifecycle and job queue
- [LIFECYCLE_FSM_REDESIGN.md](./LIFECYCLE_FSM_REDESIGN.md) — target lifecycle resting-state redesign

---

## 9. Summary

This layered architecture is scalable, aligns with **ISA-TR88.00.02 (PackML)**, and is well suited for modern Industry 4.0 production systems integrating PLCs, EtherCAT, vision systems, robots, MES/ERP, and traceability services.

**Modes → Lifecycle → PackML → Milestones** keeps each concern testable, auditable, and maintainable without overloading the controller state machine with business workflow.
