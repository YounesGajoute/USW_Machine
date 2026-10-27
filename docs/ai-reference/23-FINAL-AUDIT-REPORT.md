# Final audit report — USM-ARCH-AUDIT-001

Last generated audit date: 2026-10-22.

**Purpose:** deliver the source-based engineering reference and its acceptance record.

**Scope:** requested US Machine repository audit; new documentation only.

**Evidence status:** source findings CONFIRMED unless qualified; runtime/external verification UNVERIFIED or OUT_OF_SCOPE. **Final acceptance: COMPLETE WITH LIMITATIONS.**

## A. Project identification

US Machine is an industrial React/TypeScript HMI with a Node/Express coordinator for references, setup, production, centring, pick-and-place, pneumatic/lifter I/O, vision checks and history. SQLite stores configuration/users/catalog/history; Python/pysoem controls the EtherCAT bridge. Source roots: backend, frontend, scripts, centring firmware and P&P master. External controller images, vision server and optional desktop host remain separate boundaries. Evidence: `backend/index.mjs:L17-L129`, `frontend/src/App.tsx:L164-L213`, `backend/package.json:L14-L22`.

## B. Architecture findings

Express registers direct and delegated routes; in-process lifecycle/queue modules coordinate devices and persistence. Browser state is owned by contexts/hooks; machine snapshots are polled, while vision live events use an external Socket.IO service. Controller command queues and Python process pipes are distinct transports. The checked-in P&P sketch is a nonoperational stub; actual deployed controller behavior cannot be inferred from it (`New_version_pick&place/src/main.cpp:L98-L104`). See 03–14 for detailed source evidence and diagrams.

## C. Repository coverage

545 implementation/configuration files inspected with explicit depth; 21,404 files excluded by recorded reasons. Layer totals: backend 163, frontend 201, hardware 67, infrastructure 102, reference 12. One isolated reference-copy import is unresolved and one credential-bearing TS helper is declarations-only. Excluded counts by layer and the distinction between structural/targeted review and runtime verification are in [22](./22-AUDIT-EVIDENCE-AND-COVERAGE.md). No material first-party runtime source area was silently skipped; external firmware/host boundaries remain explicit.

## D. API and integration results

193 registered method/path patterns; 109 raw frontend HTTP sites; 114 expanded operations. 112 MATCHED, 1 conditional POTENTIAL_MISMATCH and 1 external DYNAMIC_UNRESOLVED. 113 match local method/path patterns. 96 endpoint IDs have frontend references; 97 have none detected. No missing local HTTP route was found. The conditional mismatch is the generic settings client against the earlier fixed system facade; no active caller was found. 23 optional IPC methods lack a repository host implementation; external vision producer behavior remains unverified.

## E. Documentation generated

**46 new artifacts:** 23 required reference documents, this final report, 14 JSON manifests and 8 Mermaid diagrams. All are under `docs/ai-reference/`. “Complete” below means generated and statically checked with the limitations in 22; diagrams were source-reviewed but not rendered. The pre-existing endpoint manifest is preserved; its new audited replacement uses a dated filename.

| Artifact relative to docs/ai-reference | Completion |
|---|---|
| [00-START-HERE.md](./00-START-HERE.md) | Complete |
| [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) | Complete |
| [02-REPOSITORY-INVENTORY.md](./02-REPOSITORY-INVENTORY.md) | Complete |
| [03-SYSTEM-ARCHITECTURE.md](./03-SYSTEM-ARCHITECTURE.md) | Complete |
| [04-BACKEND-ARCHITECTURE.md](./04-BACKEND-ARCHITECTURE.md) | Complete |
| [05-API-REFERENCE.md](./05-API-REFERENCE.md) | Complete |
| [06-FRONTEND-ARCHITECTURE.md](./06-FRONTEND-ARCHITECTURE.md) | Complete |
| [07-FRONTEND-SCREEN-MAP.md](./07-FRONTEND-SCREEN-MAP.md) | Complete |
| [08-DATABASE-ARCHITECTURE.md](./08-DATABASE-ARCHITECTURE.md) | Complete |
| [09-FRONTEND-BACKEND-CONTRACTS.md](./09-FRONTEND-BACKEND-CONTRACTS.md) | Complete |
| [10-REALTIME-COMMUNICATION.md](./10-REALTIME-COMMUNICATION.md) | Complete |
| [11-HARDWARE-AND-INTEGRATIONS.md](./11-HARDWARE-AND-INTEGRATIONS.md) | Complete |
| [12-BUSINESS-WORKFLOWS.md](./12-BUSINESS-WORKFLOWS.md) | Complete |
| [13-CONFIGURATION-AND-DEPLOYMENT.md](./13-CONFIGURATION-AND-DEPLOYMENT.md) | Complete |
| [14-ERRORS-AND-RECOVERY.md](./14-ERRORS-AND-RECOVERY.md) | Complete |
| [15-TESTING-AND-VALIDATION.md](./15-TESTING-AND-VALIDATION.md) | Complete |
| [16-DEPENDENCY-AND-IMPACT-MAP.md](./16-DEPENDENCY-AND-IMPACT-MAP.md) | Complete |
| [17-TECHNICAL-DEBT-AND-RISKS.md](./17-TECHNICAL-DEBT-AND-RISKS.md) | Complete |
| [18-AI-AGENT-DEVELOPMENT-GUIDE.md](./18-AI-AGENT-DEVELOPMENT-GUIDE.md) | Complete |
| [19-CHANGE-REQUEST-PLAYBOOK.md](./19-CHANGE-REQUEST-PLAYBOOK.md) | Complete |
| [20-KNOWN-UNKNOWNS.md](./20-KNOWN-UNKNOWNS.md) | Complete |
| [21-DOCUMENTATION-MAINTENANCE.md](./21-DOCUMENTATION-MAINTENANCE.md) | Complete |
| [22-AUDIT-EVIDENCE-AND-COVERAGE.md](./22-AUDIT-EVIDENCE-AND-COVERAGE.md) | Complete |
| [23-FINAL-AUDIT-REPORT.md](./23-FINAL-AUDIT-REPORT.md) | Complete |
| [diagrams/api-request-lifecycle.mmd](./diagrams/api-request-lifecycle.mmd) | Complete — render unverified |
| [diagrams/backend-dependencies.mmd](./diagrams/backend-dependencies.mmd) | Complete — render unverified |
| [diagrams/database-relationships.mmd](./diagrams/database-relationships.mmd) | Complete — render unverified |
| [diagrams/frontend-dependencies.mmd](./diagrams/frontend-dependencies.mmd) | Complete — render unverified |
| [diagrams/machine-state-flow.mmd](./diagrams/machine-state-flow.mmd) | Complete — render unverified |
| [diagrams/realtime-event-flow.mmd](./diagrams/realtime-event-flow.mmd) | Complete — render unverified |
| [diagrams/runtime-architecture.mmd](./diagrams/runtime-architecture.mmd) | Complete — render unverified |
| [diagrams/system-context.mmd](./diagrams/system-context.mmd) | Complete — render unverified |
| [manifests/api-endpoints.audit-2026-10-22.json](./manifests/api-endpoints.audit-2026-10-22.json) | Complete |
| [manifests/audit-validation.json](./manifests/audit-validation.json) | Complete |
| [manifests/backend-modules.json](./manifests/backend-modules.json) | Complete |
| [manifests/change-impact-index.json](./manifests/change-impact-index.json) | Complete |
| [manifests/database-entities.json](./manifests/database-entities.json) | Complete |
| [manifests/environment-references.json](./manifests/environment-references.json) | Complete |
| [manifests/feature-dependencies.json](./manifests/feature-dependencies.json) | Complete |
| [manifests/frontend-api-calls.json](./manifests/frontend-api-calls.json) | Complete |
| [manifests/frontend-components.json](./manifests/frontend-components.json) | Complete |
| [manifests/hardware-modules.json](./manifests/hardware-modules.json) | Complete |
| [manifests/risk-register.json](./manifests/risk-register.json) | Complete |
| [manifests/socket-events.json](./manifests/socket-events.json) | Complete |
| [manifests/source-inventory.json](./manifests/source-inventory.json) | Complete |
| [manifests/unresolved-items.json](./manifests/unresolved-items.json) | Complete |

Preserved collision: `manifests/api-endpoints.json` was not overwritten or used as evidence. Use `manifests/api-endpoints.audit-2026-10-22.json` for this mission.

## F. Architectural findings

The risk register contains 43 source-evidenced findings: 11 high, 27 medium, 5 low. These are conditional risks and source limitations, not 43 observed incidents. Highest-priority items include:

- Hardware-capable HTTP writes without consistent authentication or machine-operation gating.
- Camera-unavailable inspection skipping that can coexist with a final PASS.
- Shared source signing/encryption fallback keys under specified launcher/environment conditions.
- EtherCAT OP-maintainer startup race and selected-slave versus index-zero I/O mismatch.
- Serialized P&P STOP/ESTOP behind an in-flight motion transaction and missing deployed firmware provenance.

Every finding has source references, conditions, confidence/limitations and follow-up guidance in [17](./17-TECHNICAL-DEBT-AND-RISKS.md) and `risk-register.json`. No repair was authorized or made.

## G. Agent readiness

Start with [00-START-HERE](./00-START-HERE.md), choose one of 15 features, traverse the 765-node/2,212-edge impact graph, verify current source, then follow 18/19 for the next authorized change. Tests are selected using 15 and reviewed for transitive side effects. Documentation is a navigation aid; current implementation remains authoritative.

## H. Unresolved evidence

Active settings/services and installed versions; physical wiring, slave order, deployed firmware and timing; external vision schemas/events; optional desktop host; dependency-owned sessions schema; production quality policy for skipped vision; dynamic/transitive behavior beyond static proof. All 16 records and safe next evidence are in [20](./20-KNOWN-UNKNOWNS.md). The source-copy missing import and filename collision are also explicit.

## I. Operational safety confirmation

No production source/configuration, database, dependency installation, running service or hardware state was changed by this audit. No application tests/builds, network/device requests, camera capture, deployment, firmware flashing or service control were performed. Only new reference artifacts and temporary static-analysis work files were written. Initial untracked captures and the old endpoint manifest were preserved. Integrity and artifact check results are recorded in [audit-validation.json](./manifests/audit-validation.json).

## J. Final acceptance status

**COMPLETE WITH LIMITATIONS.** The requested source-reference documents, inventories, contracts, workflows, dependency indexes and agent protocol are delivered. Runtime/physical certification, external source reconstruction, exhaustive branch proof and risk remediation were outside this source-only mission. The requested endpoint filename collision was resolved by preserving existing material and using the dated catalog.

## Important dependencies and known limitations

Read [22](./22-AUDIT-EVIDENCE-AND-COVERAGE.md) for exact verification scope. JSON/link/reference/graph/integrity checks validate artifact consistency; they do not prove production correctness. No claim of passing application tests is made. Mermaid syntax was reviewed locally but not rendered.

## Related documentation

[Entry guide](./00-START-HERE.md), [coverage](./22-AUDIT-EVIDENCE-AND-COVERAGE.md), [risks](./17-TECHNICAL-DEBT-AND-RISKS.md), [unknowns](./20-KNOWN-UNKNOWNS.md).
