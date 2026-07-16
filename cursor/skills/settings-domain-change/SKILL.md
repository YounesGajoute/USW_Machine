---
name: settings-domain-change
description: >-
  Change industrial settings domains via SettingsService (ACL, audit, ETags,
  onApply). Use when adding/editing settings domains, PATCH /api/settings,
  settings HMI sections, settingsBridge, schemaVersion, or config persistence.
---

# Settings domain change

## Purpose

Keep all configuration changes on the SettingsService write pipeline. Never bypass with raw SQLite blob merges or competing store writes after boot.

## Read first

1. `backend/lib/settings/ARCHITECTURE.md`
2. `.cursor/rules/settings-architecture.mdc`
3. Domain under edit in `backend/lib/settings/domains/` + registration in `domains/all.mjs`

## Source of truth

| Layer | Path |
|-------|------|
| Service / mutex | `backend/lib/settings/service.mjs` |
| Registry / ETags | `backend/lib/settings/registry.mjs` |
| Domain register | `backend/lib/settings/domainRegistry.mjs`, `domains/all.mjs` |
| ACL | `backend/lib/settings/settingsAcl.mjs` |
| Audit | `backend/lib/settings/audit.mjs` |
| Routes | `backend/lib/settings/routes.mjs` |
| Bridge (legacy stores) | `backend/lib/settings/settingsBridge.mjs` |
| HMI | `frontend/src/components/settings/`, `frontend/src/services/settingsApi.ts` |

## Domains (sensitivity)

`ui` (device) · `general` (medium) · `pick_place` / `centring` / `production_sequence` / `vision` (high) · `serial` / `access` / `system` (admin)

Each domain must expose: `schemaVersion`, `defaults`, `normalize`, `mergePatch`; optional `migrate`, `onApply`, `publicProjection`.

## Workflow

```
Progress:
- [ ] 1. Identify domain + sensitivity
- [ ] 2. Update domain module (defaults / normalize / mergePatch / migrate)
- [ ] 3. Register or keep registration in domains/all.mjs
- [ ] 4. Wire ACL (settingsAcl) for new flat keys / tabs
- [ ] 5. Update onApply if motion/serial caches must refresh
- [ ] 6. Update HMI section + settingsApi types
- [ ] 7. Prefer domain PATCH + If-Match (not only flat PUT /system)
- [ ] 8. Run settings tests + targeted e2e
```

### Forbidden

- Direct writes to legacy blobs competing with SettingsService after boot
- Authorizing high/admin fields with coarse domain sensitivity alone
- Exposing secrets in public GET / unauthenticated views
- Skipping audit on high-sensitivity patches

### Write pipeline (must preserve)

`authorize` → `mergePatch` / validate → SQLite txn (`settings_domain` + `settings_audit`) → Registry → mirror blob → `onApply`

## Validation

```bash
npm test --prefix backend
# Focus settings:
node --test backend/lib/settings/*.test.mjs
node backend/scripts/hmi-settings-e2e.mjs   # when HMI path changed
```

## Output checklist

- [ ] `schemaVersion` bumped when shape changes
- [ ] ACL covers new keys
- [ ] Audit row on high-sensitivity write
- [ ] HMI shows units / ranges / save feedback
- [ ] No secrets in logs or public projection
