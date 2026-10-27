# Known unknowns and evidence boundaries

Last generated audit date: 2026-10-22.

**Purpose:** prevent future agents from treating source inference as observed production behavior.

**Scope:** unresolved repository/external/runtime questions remaining after the source audit.

**Evidence status:** each record explicitly distinguishes `UNVERIFIED`, `NOT_IMPLEMENTED` and `OUT_OF_SCOPE`. These are verification boundaries, not claims of observed failure.

## Open evidence register

### U01 — deployment (UNVERIFIED)

Active services, process versions, installed units, environment overrides and reachable listeners were not inspected.

Evidence: `backend/index.mjs:L2965-L2988`, `scripts/plymouth/us-machine-headless-web.service.in:L1-L20`

Required next evidence: Separately authorized read-only host metadata and operator-supplied redacted effective configuration.

### U02 — hardware (UNVERIFIED)

Actual GPIO/PDO wiring, polarities, connected EtherCAT slave order and relay/drive safety behavior remain unverified.

Evidence: `backend/config/ethercat.config.json:L5-L55`, `scripts/ethercat_bridge.py:L244-L268`

Required next evidence: Approved wiring/device inventory and isolated commissioning evidence; no live actuation during documentation audit.

### U03 — firmware (OUT_OF_SCOPE)

Actual deployed pick-and-place firmware source is not established; checked-in sketch has no operational TCP/motion loop.

Evidence: `New_version_pick&place/src/main.cpp:L98-L104`

Required next evidence: Matching firmware source/build provenance and deployed-image identity supplied by owner.

### U04 — firmware (UNVERIFIED)

Centring source cannot establish which built image/configuration is flashed on the machine.

Evidence: `Double_Actuator_Centring_Slave_Firmware/src/main.cpp:L1-L16`

Required next evidence: Approved build/image provenance; do not flash or read device merely for this audit.

### U05 — vision (OUT_OF_SCOPE)

External vision server handlers/event producers and exact response/error schemas are absent.

Evidence: `frontend/src/services/visionService.ts:L47-L70`, `frontend/src/services/visionService.ts:L629-L710`, `backend/lib/visionProgramTools.mjs:L27-L40`

Required next evidence: External server source/specification or authorized captured fixtures without production secrets.

### U06 — host (NOT_IMPLEMENTED)

No Electron main/preload host exposing electronAPI was found in inspected first-party source; browser IPC fallbacks remain.

Evidence: `frontend/src/services/ipcClient.ts:L10-L39`, `frontend/src/services/ipcClient.ts:L78-L149`

Required next evidence: If a separate deployed desktop shell exists, obtain its source/contract as a separate scope.

### U07 — database (UNVERIFIED)

Live schema/migration state and rows were not read; documentation reconstructs schema from source only.

Evidence: `backend/lib/db.mjs:L279-L342`

Required next evidence: Isolated schema export or approved migration validation on a nonproduction copy.

### U08 — database (OUT_OF_SCOPE)

Sessions physical table definition is owned by better-sqlite3-session-store; implementation dependency source excluded.

Evidence: `backend/index.mjs:L239-L248`, `backend/package.json:L15-L16`

Required next evidence: Targeted dependency-source review or isolated scratch-store initialization separately authorized.

### U09 — secrets (UNVERIFIED)

Effective environment/seed credentials and encryption signing-key choices were intentionally not inspected.

Evidence: `backend/lib/sessionSecret.mjs:L53-L85`, `backend/lib/settings/secrets.mjs:L51-L69`

Required next evidence: Owner-provided nonsecret configuration attestations or narrowly scoped secure verification.

### U10 — validation (UNVERIFIED)

Application tests, builds, latency, recovery, race manifestation and physical acceptance were not run.

Evidence: `backend/package.json:L5-L12`, `scripts/ethercat_bridge.py:L691-L747`

Required next evidence: Isolated test plan from15, then separately authorized deployment/commissioning if required.

### U11 — reference-copy (UNVERIFIED)

main-animation backend test imports an absent sibling productionVisionInspection.mjs.

Evidence: `main-animation/backend/lib/visionChecksConfigStore.test.mjs:L14`

Required next evidence: Determine whether to remove/update archived copy in a separately authorized source change.

### U12 — documentation (OUT_OF_SCOPE)

Existing api-endpoints.json collided with requested output and was preserved, not used or reconciled.

Evidence: Initial destination/Git metadata; no source claim.

Required next evidence: Future explicit reconciliation may choose a canonical name; current dated endpoint manifest is authoritative for this audit.

### U13 — coverage (UNVERIFIED)

Dynamic field semantics, conditional transitive side effects and branch completeness exceed static extraction guarantees.

Evidence: `backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2192-L2199`

Required next evidence: Review exact affected service chains and isolated contract tests for each future change.

### U14 — quality-policy (UNVERIFIED)

Business acceptance policy for skipped camera inspection and PASS outcome was not supplied.

Evidence: `backend/lib/productionVisionInspection.mjs:L450-L496`, `backend/lib/productionJobQueue.mjs:L315-L325`

Required next evidence: Owner-defined quality policy and isolated scenario tests before any behavior change.

### U15 — network (UNVERIFIED)

All-interface binding/CORS and unguarded control routes are source facts; actual firewall/origin exposure unknown.

Evidence: `backend/index.mjs:L223-L228`, `backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2965-L2966`

Required next evidence: Approved network exposure review; no unsolicited requests or penetration tests.

### U16 — seed-source (UNVERIFIED)

Credential-bearing frontend seed helper is indexed by declarations; initializer values and full body behavior excluded.

Evidence: `frontend/src/lib/defaultUsersConfig.ts:L5-L24`

Required next evidence: Narrowly scoped credential-safe review if a future auth task requires it; never publish seed values.

## Important dependencies

Each future change should consult the relevant unresolved IDs before choosing tests or deployment assumptions. Machine-readable records are in [unresolved-items.json](./manifests/unresolved-items.json); issue/risk evidence is separate in [17](./17-TECHNICAL-DEBT-AND-RISKS.md).

## Known limitations

This register is bounded by the current checkout and explicit audit exclusions. Lack of a detected direct import or UI caller does not prove runtime impossibility. No operational verification should be inferred from completion of documentation.

## Related documentation

[Hardware](./11-HARDWARE-AND-INTEGRATIONS.md), [validation](./15-TESTING-AND-VALIDATION.md), [coverage](./22-AUDIT-EVIDENCE-AND-COVERAGE.md), [agent guide](./18-AI-AGENT-DEVELOPMENT-GUIDE.md).
