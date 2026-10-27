# Documentation maintenance and drift control

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Keep the reference consistent with implementation without turning documentation into a competing design.

**Scope:** Review/update workflow for the new reference set.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## Required rule

**Documentation must be updated when implementation changes, but implementation must never be changed merely to match documentation without a separately authorized engineering task.**

## Identify affected evidence

Use the changed paths and exported symbols to query `change-impact-index.json`. Follow direct imports, frontend call-site bindings and entity/feature ownership; do not infer runtime call reachability from import edges alone. Compare source hashes in `source-inventory.json` as a fast drift signal. A changed hash means re-review, not that every fact about the file became false.

For route changes, recheck registration order, mounted prefixes, dynamic handler branches, middleware, schemas and frontend callers. For settings/storage changes, review schema creation, migration, validation, secret handling, persistence and runtime application. For hardware changes, update command formats, timeout/cancellation logic and the source/deployed-image boundary.

## Updating records

1. Re-inspect changed implementation and affected call chains.
2. Update only affected document sections and manifest records, preserving stable IDs where semantics remain the same.
3. Refresh symbols and precise line references after edits or moves; record the new audit date/commit and hashes.
4. Update forward and reverse graph relationships together.
5. Recheck diagrams against the corresponding source facts. Diagram edges must remain supported by actual imports/calls/protocol usage.
6. Preserve unresolved item IDs and append resolution evidence; never silently delete uncertainty because code was reorganized.
7. Mark obsolete route/feature entries explicitly, with replacement and evidence, or remove them with a recorded change rationale.
8. Parse JSON, validate local links/source references and inspect the final Git diff.

The static reference-check script recommended for future use should only open text files; it must not import app modules, connect to services, query production databases or evaluate shell launchers. No CI or package tooling was modified during this audit.

## Suggested future automated checks

| Check | Expected guarantee | Does not establish |
|---|---|---|
| JSON parse plus required-key validation | Manifests readable, schema fields present | Semantic correctness |
| Source path/line/symbol existence | Citations target current implementation | A claim is supported merely because a line exists |
| Import graph rebuild with a proper parser | Direct dependency edges and moves | Dynamic calls, conditional runtime reachability |
| Route/call reconciliation | URLs/methods and known mounts align | External vision service behavior |
| Isolated contract tests | Response and validation behavior for exercised handlers | Machine safety or live deployment configuration |
| Documentation diff review | Changed behavior reflected in affected references | Untouched references never drift |

Schema/layout details and inspection limits are in [02](./02-REPOSITORY-INVENTORY.md) and [22](./22-AUDIT-EVIDENCE-AND-COVERAGE.md). For this audit, the preserved colliding `api-endpoints.json` is not updated; use `api-endpoints.audit-2026-10-22.json` consistently until a future authorized reconciliation explicitly chooses a canonical file.

Source anchors for high-drift areas: route bootstrap `backend/index.mjs:L168-L218`, frontend routing/providers `frontend/src/App.tsx:L164-L213`, deployment port/proxy defaults `frontend/vite.config.ts:L14-L38`.

## Important dependencies

Git changes, stable file paths, manifest IDs, source hashes and precise evidence ranges.

## Known limitations

Static validation cannot prove a claim; human/agent source review remains necessary. Generated reference artifacts do not replace external system documentation or safe acceptance testing.

## Related documentation

[02-REPOSITORY-INVENTORY.md](./02-REPOSITORY-INVENTORY.md), [18-AI-AGENT-DEVELOPMENT-GUIDE.md](./18-AI-AGENT-DEVELOPMENT-GUIDE.md), [22-AUDIT-EVIDENCE-AND-COVERAGE.md](./22-AUDIT-EVIDENCE-AND-COVERAGE.md).
