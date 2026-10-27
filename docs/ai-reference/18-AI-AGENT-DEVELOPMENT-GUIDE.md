# AI agent development protocol

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Provide a repeatable process for future authorized engineering tasks.

**Scope:** Future missions; this audit itself authorizes documentation only.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## A — Understand the mission

Read [00](./00-START-HERE.md), look up the feature in `manifests/feature-dependencies.json`, and use `manifests/change-impact-index.json` to find adjacent files and tests. Read only affected reference documents, then inspect current source. Check Git state and existing changes before editing. Confirm that evidence hashes/line references still correspond to the checkout; source wins when they differ.

This protocol is a recommended workflow, not evidence that a future task has been authorized. Follow that task's actual scope and instructions.

## B — Analyze impact

Trace the concrete UI handler → client method → route/middleware → service → state/storage → hardware/external operation → response/poll/event → UI chain. Record frontend components, backend services, API shapes, DB entities, events, configuration, hardware effects, regression-sensitive branches and tests. Include absence/unresolved nodes rather than inventing host capabilities.

For example, machine starts use the production queue, while low-level manual routes may bypass queue/auth guards (`backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2248-L2263`, `backend/lib/productionJobQueue.mjs:L367-L395`). A change to a button can therefore require more than a visual edit.

## C — Plan the implementation

Write the technical objective, exact files, intended changes, contract/version compatibility, state migration requirements, safety conditions, validation and rollback strategy. Preserve current operator semantics unless the mission changes them. Determine whether the change touches initialization, a loaded reference, running/queued jobs, maintenance, or a safety lockout.

## D — Implement within authorization

Make the smallest coherent change. Preserve pre-existing work, unrelated behavior and repository instructions. Update connected layers together. Do not refactor unrelated machine logic. Do not use documentation to justify changing implementation without a separately authorized task.

Starting the backend is an operational action: it migrates/synchronizes persistent state and normally starts hardware connection management (`backend/index.mjs:L168-L217`, `backend/index.mjs:L239-L248`, `backend/index.mjs:L2965-L2988`). An import graph or a script name is not a safety guarantee.

## E — Validate

Select tests through [15](./15-TESTING-AND-VALIDATION.md). Review transitive imports and top-level side effects before execution. Use isolated storage and fake transports when the test actually supports them. Verify request/response contracts, permissions, error branches, teardown, state resets and affected hardware semantics. Validate only under the operating conditions and permissions actually supplied for that mission.

Record exactly what ran, exit codes/results, what was inspected only, and what remains unverified. Never convert “test source exists” into “tests passed.” If a full build is prohibited, use allowed static checks and say what they do not establish.

## F — Synchronize documentation

Update affected source references, endpoint/component/entity records, feature links and diagrams. Preserve unresolved findings and document whether new evidence resolves them. Follow [21](./21-DOCUMENTATION-MAINTENANCE.md); avoid rewriting unrelated evidence.

## G — Report

Report requested behavior, implemented behavior, changed files and reasons, validation results, unverified cases, material risks and documentation updates. Distinguish source verification from runtime/physical acceptance. Link the concrete changed artifact and entry document.

## Important dependencies

Requires current source, version-control state and the feature/API/test indexes.

## Known limitations

Recommendations do not certify tests as safe on the live installation. Runtime and hardware authorization must come from the future mission.

## Related documentation

[00-START-HERE.md](./00-START-HERE.md), [16-DEPENDENCY-AND-IMPACT-MAP.md](./16-DEPENDENCY-AND-IMPACT-MAP.md), [19-CHANGE-REQUEST-PLAYBOOK.md](./19-CHANGE-REQUEST-PLAYBOOK.md), [21-DOCUMENTATION-MAINTENANCE.md](./21-DOCUMENTATION-MAINTENANCE.md).
