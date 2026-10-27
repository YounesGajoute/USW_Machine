# Repository inventory and manifest schemas

Last generated audit date: 2026-10-22.

**Purpose:** account for the source inspected and define the programmatic knowledge-base records.

**Scope:** the repository root `/home/bot/US Machine` at commit `3c44f433b8eef3281cefc718ccbbc946459c0460`. `.git` internals are pruned; symlink targets outside the repository are not traversed. Existing documentation and production data contents were excluded.

**Evidence status:** `CONFIRMED` for filesystem/source structure, with runtime/whole-file behavioral verification remains `UNVERIFIED`; the separate source_review_scope and inspection_depth fields record structural/targeted review. No runtime deployment claims.

## Coverage and roots

The inventory contains **545 implementation/configuration files** and records **21,404 excluded files** by path and reason. All 545 received source-structure inspection; targeted control-flow review concentrates on application initialization, APIs, storage, safety/production, hardware, frontend state and operator actions. This is not a claim that every possible branch or runtime interleaving was proved. One reference-copy test has an unresolved internal import; one credential-bearing TypeScript seed helper is recorded by declarations only.

| Inventory layer | Inspected files | Definition |
|---|---:|---|
| infrastructure | 102 | shell/service/template/build/configuration files and operator scripts |
| hardware | 67 | firmware, P&P master/tools, bridge/client and retained hardware reference source |
| backend | 163 | backend runtime/lib/config/manifests; backend scripts categorized infrastructure |
| frontend | 201 | frontend source, build/dependency configuration and static theme entry; frontend scripts infrastructure |
| reference | 12 | main-animation and master-ui-reference source copies |

The layer totals include tests/configuration; do not add the specialized backend/frontend/hardware manifest totals because those scopes overlap. One Git boundary was found at this root; installed dependency repositories and `.git` objects were not analyzed.

| Root | Actual role and evidence |
|---|---|
| `backend/` | Express coordinator and SQLite; `backend/package.json:L5-L12`, `backend/index.mjs:L168-L218` |
| `frontend/` | React SPA and Vite tooling; `frontend/src/main.tsx:L1-L10`, `frontend/src/App.tsx:L164-L213` |
| `New_version_pick&place/master/` | Runtime P&P controller client imported through adapters; embedded sketch separately incomplete |
| `Double_Actuator_Centring_Slave_Firmware/` | Arduino centring source and PlatformIO/tooling; source image identity remains unverified |
| `scripts/` | Active bridge/vision client, deployment, kiosk/network and hardware diagnostics |
| `boot-setup-bundle/` | Copied install/service templates; source copies do not establish installed host state |
| `ethercat comunication base/` | Retained bridge/GPIO/printer integration reference; active backend linkage must be traced |
| `master-ui-reference/`, `main-animation/` | Isolated source copies, not imported from the main SPA import closure |
| `EtherCard-main/` | Vendored networking library/examples, excluded from detailed first-party review |
| `backend/data/`, `frontend/server/data/`, `tmp/`, `captures/` | Runtime databases/backups/captures/reports; contents not inspected |
| `.cursor/`, `cursor/` | Existing explanatory rules and editor state excluded as architectural evidence |
| `arduino/`, `updrade_project/` | No first-party executable source discovered in current directory listing |

The obsolete `frontend/server` package delegates start/admin commands to the actual backend (`frontend/server/package.json:L1-L10`). The standalone `frontend/theme.html` is a static theme sample without a script/module entry; main SPA startup uses `frontend/index.html:L1-L12`. `main-animation/backend/lib/visionChecksConfigStore.test.mjs:L14` imports a missing sibling `productionVisionInspection.mjs`; do not redirect that dependency mentally to the active backend.

## Exclusions

Each excluded file receives exactly one reason. Counts include metadata enumeration inside dependency/cache trees, not detailed content inspection. Two editor JSON files listed in source-inventory.excluded_content_inspection_exceptions were structurally read and excluded from application coverage. Audit output itself and `.git` internals are outside the denominator.

| Exclusion | Files |
|---|---:|
| existing_documentation_not_evidence | 102 |
| generated_build_metadata | 2 |
| credentials_or_environment_values | 7 |
| installed_dependency_cache_build_or_protected_metadata | 18244 |
| runtime_data_capture_or_firmware_image | 2932 |
| binary_asset_or_nonimplementation_resource | 36 |
| editor_configuration_not_application | 28 |
| vendored_library_and_examples | 53 |

`.env` files, seed JSON files, session secrets, databases/WAL/SHM, capture/soak records and backup values were not used as evidence. Dependency locks were parsed as implementation configuration; installed dependency source was not audited. Requirements text files are dependency manifests, not explanatory documentation.

## Machine-readable schema conventions

All generated manifests are UTF-8 JSON objects with `schema_version` and `audit_date`. `schema_version` is currently numeric 1 or string "1.0" depending on the producer; consumers should normalize these to schema major 1. An absent/empty list means no statically detected record, not a proven runtime absence. Evidence objects use repository-relative `path`, `start_line`, `end_line`; string citations use `path:Lstart-Lend`. Dates use 2026-10-22 in the user's timezone.

Confidence vocabulary: `CONFIRMED` direct source evidence; `INFERRED` connected evidence requiring qualification; `UNVERIFIED` runtime/missing evidence; `NOT_IMPLEMENTED` absent from the inspected area; `OUT_OF_SCOPE` external or intentionally excluded. `MATCHED` in the contract map means method/path matches plus documented source review; it does not mean external schemas or every response branch have been tested.

| Manifest | Top-level records | Record schema / interpretation |
|---|---|---|
| [source-inventory.json](./manifests/source-inventory.json) | files[] and excluded[] | File path/language/layer/role/responsibility; symbol names/lines; imports and resolution; entry signature, criticality, SHA-256, inspection depth, evidence status, limitations. excluded records hold only path+reason. counts use mutually exclusive file classification. |
| [backend-modules.json](./manifests/backend-modules.json) | modules[] | path, symbols with exact source/parameters/return sites, exports, internal/external dependencies, callers, tests, effects, persistence and concurrency signals. Expression/signal presence is not runtime proof. |
| [frontend-components.json](./manifests/frontend-components.json) | modules[] | file_path, kind, responsibility, symbols/props, imports/rendered JSX, hooks/local/global state, service/API/event references, reachability from main and inspection limitations. Includes helpers/styles/types and isolated copies, not only rendered components. |
| [api-endpoints.audit-2026-10-22.json](./manifests/api-endpoints.audit-2026-10-22.json) | endpoints[] | Stable id=METHOD path; method/path/transport/registration; source and handler; request fields/aliases and constraints; response expressions/source; errors/auth/authorization; side effects; consumers and evidence. These are implementation evidence, not fabricated exhaustive JSON Schemas. |
| [frontend-api-calls.json](./manifests/frontend-api-calls.json) | calls[] and generic_wrappers[] | Raw source call site and wrapper, resolved URL/method expansion, request expression, expected-response evidence, backend endpoint IDs/responses, integration status and reachability. Expanded operations differ from raw source count. |
| [socket-events.json](./manifests/socket-events.json) | network_events[], ipc_operations[], ipc_progress_event{}, browser_events[], broadcast_channels[], counts{} | Network event registrations, IPC/browser signals and auth BroadcastChannel; producers/consumers and payload/reconnect evidence. Polling and bridge behavior are in 10, not separate manifest arrays. External producers explicitly unresolved. |
| [database-entities.json](./manifests/database-entities.json) | entities[] and filesystem_persistence[] | SQL entity names, statically declared columns/constraints/indexes, direct lexical query accesses and relationships. sessions schema opaque because dependency-owned; no production values. |
| [feature-dependencies.json](./manifests/feature-dependencies.json) | features[] | id/name/purpose; primary source/frontend/backend files; endpoints, entities, hardware, public contracts, state, tests, regressions and source evidence. Curated ownership is separate from causal graph edges. |
| [change-impact-index.json](./manifests/change-impact-index.json) | nodes[], edges[], incoming{}, outgoing{}, symbol_index{} | Typed file/endpoint/entity/feature nodes. Edges contain from/to, relationship, evidence/status/limits. Reverse and forward indexes contain edge IDs. Symbol index maps files to declarations, not complete function-level dynamic call graph. |
| [hardware-modules.json](./manifests/hardware-modules.json) | modules[] | path, declared symbols/imports, side-effect candidates, responsibility and review depth for firmware/adapters/launchers/diagnostics. Empty effects list is not a safety guarantee. |
| [environment-references.json](./manifests/environment-references.json) | variables[] | name and source references only; 315 literal names, 1490 occurrences. No values. Dynamic environment names and shell-only assignment identifiers are not exhaustive. |
| [unresolved-items.json](./manifests/unresolved-items.json) | items[] | Stable ID, category, status, finding, evidence, condition/required evidence, and safe next step. Records are retained until specific evidence resolves them. |
| [risk-register.json](./manifests/risk-register.json) | risks[] | Stable finding ID, severity, source finding, conditions, evidence/status, limits and optional suggested verification. Severity is engineering triage, not proof of live failure. |
| [audit-validation.json](./manifests/audit-validation.json) | Generated validation summary | Counts, checked paths/ranges/links/graph references, source integrity and scope limitations. No application test results are implied. |

The pre-existing `manifests/api-endpoints.json` is preserved and excluded from this audit. It was not read for architectural evidence or reconciled. Use the dated endpoint file linked above; do not silently merge the two.

## Important dependencies

Static imports are resolved relative to the source file, or through Vite's `@` alias (`frontend/vite.config.ts:L11-L13`). Alias navigation in isolated copied files is only inferred because those copies lack their own active build configuration. Direct imports and schema/query text provide ownership links; a declaration/import graph is not a dynamic call graph.

## Known limitations

No runtime/physical tests, builds, dependency installation or service queries were performed. Source-presence coverage differs from semantic branch coverage. The encrypted credential store's values, active settings and dependency-owned sessions schema remain unresolved. Full audit limits and validation outcomes are in [22](./22-AUDIT-EVIDENCE-AND-COVERAGE.md).

## Related documentation

[Overview](./01-PROJECT-OVERVIEW.md), [impact graph](./16-DEPENDENCY-AND-IMPACT-MAP.md), [unknowns](./20-KNOWN-UNKNOWNS.md), [maintenance](./21-DOCUMENTATION-MAINTENANCE.md).
