# Audit evidence and coverage

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** document exactly what was inspected, verified, excluded and preserved.

**Scope:** source-only audit of `/home/bot/US Machine`, commit `3c44f433b8eef3281cefc718ccbbc946459c0460`, followed by new documentation generation. No production edits or operational testing.

**Evidence status:** `CONFIRMED` for source facts and successful static artifact checks; runtime behavior remains `UNVERIFIED`. Final acceptance: **COMPLETE WITH LIMITATIONS**.

## Initial state and preservation

The working directory and Git root both resolved to the requested project. Initial Git status had no tracked modifications and these three untracked paths:

```text
captures/centring-nano-flash-read-20261006.hex
captures/centring-nano-ttyUSB2-flash.hex
docs/ai-reference/manifests/api-endpoints.json
```

No applicable AGENTS.md was found in the project/ancestor discovery. Existing explanatory documents were not architectural sources. The pre-existing endpoint manifest was not parsed or reused; a raw SHA-256 integrity fingerprint was recorded solely to verify preservation. All new endpoint evidence is in `manifests/api-endpoints.audit-2026-10-22.json`. The two capture files were not opened or changed.

## File coverage

| Layer/location rule | Inspected implementation/config files | Excluded metadata-counted files | Unresolved source files |
|---|---:|---:|---:|
| Backend | 163 | 5,923 | 0 |
| Frontend | 201 | 10,660 | 0; one credential helper declarations-only |
| Hardware | 67 | 344 | 0 |
| Infrastructure | 102 | 4,421 | 0 |
| Isolated reference copies | 12 | 3 | 1 missing sibling import |
| Vendored EtherCard | 0 | 53 | Outside detailed scope |
| Total | **545** | **21,404** | **1** plus the redacted helper boundary |

Counts classify each path once; specialized manifests overlap these layers. Backend module manifest 169 records, frontend module manifest 198 records and hardware module manifest 151 records are navigational subsets with different boundaries, not additive totals. `.git` internals and the audit destination (including the preserved old manifest) are outside the inventory denominator. Excluded dependency/cache/data files were metadata-enumerated; their contents were not application evidence. Two editor JSON files were structurally read by the hardware reviewer and remain excluded from application-source counts; the exception paths are explicit in `source-inventory.json`.

Every included file received source-structure inspection and a recorded reviewer/depth. Targeted control-flow review covered entrypoints, registration, permissions, settings/storage, production/interlocks/abort, hardware protocols, UI state/actions and error/recovery paths. Structural review of all files does not imply exhaustive line-by-line semantic proof, branch coverage, race freedom or runtime correctness. `runtime_verification_status` and whole-file `behavior_review_status` remain UNVERIFIED; per-fact source evidence can still be CONFIRMED.

393 JavaScript/TypeScript-family files were parsed structurally with the installed TypeScript compiler API; one credential helper was limited to import/declaration structure. Python AST and C++/shell textual declarations supplement the inventory. The final JavaScript dependency records exclude locally shadowed assertion calls named `require`; three computed P&P imports were resolved manually through constant path.join/pathToFileURL chains (`backend/lib/pickPlace.mjs:L13-L17`, `backend/lib/pickPlaceProduction.mjs:L8-L16`). The only unresolved local module target is the reference-copy test at `main-animation/backend/lib/visionChecksConfigStore.test.mjs:L14`.

## API, persistence and real-time coverage

- **193** unique registered literal method/path patterns, including delegated P&P/centring handlers and mounted settings routes. This uniqueness does not preclude a fixed concrete URL taking precedence over a parameter route.
- **109** raw HTTP call sites, including **2** generic wrappers; **114** expanded operation rows: **112 MATCHED**, **1 POTENTIAL_MISMATCH**, **1 DYNAMIC_UNRESOLVED** external call. **113** operations match local method/path patterns; payload compatibility is qualified separately.
- **96** registered endpoints have detected frontend references; **97** have none detected. An unused frontend helper or isolated copy is distinguished from a reachable main-entry module.
- **10** source-defined SQLite entity schemas plus **1** dependency-owned sessions table whose physical schema was intentionally not reconstructed from live data.
- **23** network event registration/removal occurrences, **23** optional IPC operations, **25** browser-signal occurrences and **1** auth BroadcastChannel record. These are source occurrence counts, not unique external producer events. Machine status polling and process-pipe events are described separately.
- **15** curated features and a graph of **765 nodes / 2,212 edges**, with forward/reverse indexes, source evidence and limits.

The settings special case is explicit: `getDomain('system')` expects data, but the earlier fixed GET system route returns settings. No active caller was detected. See `frontend/src/services/settingsApi.ts:L95-L99`, `backend/index.mjs:L566-L586`, `backend/lib/settings/routes.mjs:L168-L204` and [09](./09-FRONTEND-BACKEND-CONTRACTS.md).

## Verification performed

The generated [validation manifest](./manifests/audit-validation.json) records the final check results and exact counts:

1. Required document/manifest/diagram files exist; the endpoint filename collision is explicitly handled by the dated catalog.
2. Every generated JSON file parses and required record fields/IDs are checked.
3. Explicit repository-relative source references resolve and cited line ranges fit their files. Symbol declarations and graph references are checked independently.
4. Local Markdown navigation links resolve.
5. API IDs are unique; frontend endpoint references resolve; counts agree across manifests; conditional contract mismatch is retained.
6. Graph nodes/edges and forward/reverse indexes are internally consistent; feature file/entity references exist.
7. Source text fingerprints match the baseline; Git diff has no tracked changes; new untracked files outside the allowed documentation destination are absent; the preserved endpoint manifest fingerprint matches.
8. Credential-like literal patterns were screened in generated artifacts without publishing matched values; no matches were found. This pattern check is not a proof of exhaustive secret detection.
9. Eight Mermaid files were reviewed against the corresponding source architecture; diagram headers/delimiters and lifecycle transition pairs were checked. No Mermaid renderer was installed/run, so render compatibility remains UNVERIFIED.

Independent cross-review corrected generated extraction errors, expanded firmware citations, identified the settings shadow case, and reconciled hardware dependencies and accepted launcher signing-key fallbacks. Source code was not changed to make documentation agree.

## Checks intentionally not performed

No application module imports/entrypoint execution, npm test/build, firmware compilation/flashing, camera acquisition, raw hardware access, network requests, device/API requests, database queries/mutations, package installation, service restarts, provisioning scripts, reboot, or deployment. The installed TypeScript parser and Python AST were used as static tools only; application code was not evaluated.

No existing README/architecture/API report or production record values were used as evidence. Environment/seed JSON secrets remained excluded. The source AST cannot prove installed dependency versions, active services, physical safety response, actual controller images or external vision contracts.

## Important dependencies

Coverage depends on the explicit inventory/exclusions, exact source checkout and reviewer depth. [02](./02-REPOSITORY-INVENTORY.md) defines schemas and scope. [17](./17-TECHNICAL-DEBT-AND-RISKS.md) ranks 43 conditional findings; [20](./20-KNOWN-UNKNOWNS.md) preserves 16 unresolved evidence boundaries.

## Known limitations

Completion means the requested source-reference knowledge base was generated and statically checked. It does not mean all production behavior was tested, every expression's semantics were proved, or identified defects repaired. The known source gap is isolated reference material; the unavailable deployed P&P firmware and vision/Electron hosts are explicit external boundaries.

## Related documentation

[Start here](./00-START-HERE.md), [inventory/schema](./02-REPOSITORY-INVENTORY.md), [final report](./23-FINAL-AUDIT-REPORT.md), [validation selection](./15-TESTING-AND-VALIDATION.md), [unknowns](./20-KNOWN-UNKNOWNS.md).
