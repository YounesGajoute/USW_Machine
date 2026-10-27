# Database and persistence architecture

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED static implementation**, with **INFERRED / UNVERIFIED** qualifications below. Runtime was not executed.

## Purpose and scope

Document schema, CRUD ownership, migration, transaction and file-storage boundaries without reading production records.

Source-declared SQLite schema and executable queries only. Ten application-defined tables plus the externally supplied sessions table are recorded. No database was opened or queried during this audit.

## Engine, connections and migration

`better-sqlite3` opens the main DB and enables WAL (`backend/lib/db.mjs:L274-L279`). `MAIN_DATA_DB_PATH` can be absolute or relative to backend root; otherwise `backend/data/maindata.db` (`backend/lib/db.mjs:L423-L426`). History lazily opens another connection to the same path and enables WAL (`backend/lib/historyStore.mjs:L62-L71`). The Express session store reuses the main connection (`backend/index.mjs:L239-L246`). ORM models are **NOT_IMPLEMENTED in these inspected paths**: queries are SQL prepared statements and migrations are executable JavaScript.

The opening path can rename `kiosk.db` and its WAL/SHM sidecars, add columns identified through PRAGMA, drop obsolete `rbk` columns, initialize singleton settings, migrate roles and upsert built-in accounts (`backend/lib/db.mjs:L181-L272`, `backend/lib/db.mjs:L339-L417`). These are source behaviors, not evidence any migration ran on this host. Domain migration creates versioned/checksummed settings rows and missing domains in one transaction (`backend/lib/settings/migration.mjs:L10-L27`, `backend/lib/settings/migration.mjs:L78-L112`). No global schema-history migration table governs the main relational tables; `settings_meta.schema_version` belongs to the settings framework.

## Entity and CRUD map

| Entity | Schema and invariants | Writers/readers/API ownership |
|---|---|---|
| `system_settings` | Singleton integer PK constrained to1, JSON text | Seed/openDatabase; legacy config stores; settings-domain assembled mirror. GET/PUT `/api/settings/system`; `backend/lib/db.mjs:L282-L285`; `backend/lib/settings/migration.mjs:L118-L120`. |
| `users` | Text PK; username UNIQUE NOCASE; password hash/salt; active/hidden flags, role, timestamps | Startup seed sync; auth last_login/password; Admin create/patch/delete. `backend/lib/db.mjs:L286-L297`; `backend/index.mjs:L501-L561`, `backend/index.mjs:L675-L780`. |
| `product_references` | Text PK; name, active, vision/barcode/tool flags, tube ID and serialized tools/checks | Catalog GET/POST/PATCH/DELETE; reference broadcast lookup; production context and vision lookups. `backend/lib/db.mjs:L298-L314`; `backend/index.mjs:L1747-L1962`; `backend/lib/productionVisionInspection.mjs:L221-L238`. |
| `shrink_tubes` | Text PK; physical profile plus persisted derived heights/effective length/carriage targets/axis | Catalog writes and geometry refresh; settings centring patch can recompute all. `backend/lib/db.mjs:L315-L336`; `backend/index.mjs:L1504-L1681`; `backend/lib/settings/service.mjs:L310-L347`. |
| `settings_meta` | Singleton PK1; framework schema version, update time/actor | Domain migration/write service. `backend/lib/settings/migration.mjs:L12-L17`, `backend/lib/settings/migration.mjs:L159-L175`. |
| `settings_domain` | Domain-name PK; schema_version, JSON, checksum, timestamp/actor | Domain API/facade/store bridge; normalized cache and ETag projection. `backend/lib/settings/migration.mjs:L18-L25`, `backend/lib/settings/migration.mjs:L159-L172`; `backend/lib/settings/service.mjs:L291-L407`. |
| `settings_audit` | Integer autoincrement PK; domain/actor/action/before/after/reason/time; index(domain,created_at DESC) | Settings and maintenance audit inserts; Admin `/api/settings/audit`. `backend/lib/settings/audit.mjs:L5-L68`; `backend/lib/settings/routes.mjs:L58-L71`. |
| `settings_secrets` | Key PK; encrypted value and timestamp | Settings secret API pipeline; environment override; masked display/export opt-in. `backend/lib/settings/secrets.mjs:L41-L96`; `backend/lib/settings/service.mjs:L389-L391`, `backend/lib/settings/service.mjs:L521-L525`. |
| `production_runs` | UUID PK; job/reference/operator IDs and denormalized names, result, duration, vision summary, details JSON | Queue terminal persistence; history filter/export/archive APIs. indexes timestamp/reference/result. `backend/lib/historyStore.mjs:L25-L42`, `backend/lib/historyStore.mjs:L131-L164`; `backend/lib/productionJobQueue.mjs:L94-L145`. |
| `error_log` | UUID PK; code/message/severity/phase/job/reference/operator/context | Lifecycle/connectivity/job failures; error-history filter/export/archive. indexes timestamp/severity/phase. `backend/lib/historyStore.mjs:L44-L58`, `backend/lib/historyStore.mjs:L181-L207`. |
| `sessions` | **UNVERIFIED exact third-party schema**; usage established | express-session store, startup DELETE,15min expiry sweep. `backend/index.mjs:L239-L267`. |

The nine registered settings domains are `ui`, `general`, `pick_place`, `centring`, `production_sequence`, `vision`, `serial`, `access`, `system` (`backend/lib/settings/domains/all.mjs:L42-L42`, `backend/lib/settings/domains/all.mjs:L96-L96`, `backend/lib/settings/domains/all.mjs:L163-L163`, `backend/lib/settings/domains/all.mjs:L202-L202`, `backend/lib/settings/domains/all.mjs:L305-L305`, `backend/lib/settings/domains/all.mjs:L336-L336`, `backend/lib/settings/domains/all.mjs:L389-L389`, `backend/lib/settings/domains/all.mjs:L413-L413`, `backend/lib/settings/domains/all.mjs:L443-L443`). Domain validation and onApply are executable descriptor functions; do not infer nested field types from a production JSON document.

## Relationships and consistency

There are no SQL foreign-key declarations in the inspected application CREATE TABLE statements. `product_references.shrink_tube_id → shrink_tubes.id` is enforced by selected API checks: creation requires an active tube, and tube deletion rejects referenced IDs (`backend/index.mjs:L1769-L1773`, `backend/index.mjs:L1675-L1679`). History actor/reference/job IDs are logical trace links with denormalized display values; deleting a catalog object does not cascade history through SQL. `vision_program_id` refers to an external service, not another SQLite table.

Tube insert plus derived geometry refresh is transactional (`backend/index.mjs:L1532-L1554`). A centring-domain write plus audit and all derived-tube updates shares one transaction, but the cache/mirror/onApply occurs after commit (`backend/lib/settings/service.mjs:L334-L355`). Flat multi-domain settings patches and imports loop over separate commits; a later failure may leave earlier changes applied (`backend/lib/settings/service.mjs:L389-L405`, `backend/lib/settings/service.mjs:L548-L613`). ETag protection is optional, only checked when a caller supplies If-Match (`backend/lib/settings/service.mjs:L296-L304`; `backend/lib/settings/routes.mjs:L210-L223`).

Other source-supported risks: per-field user PATCH can partially update before rejecting role; short time-derived catalog IDs may collide; remote vision cleanup and local reference deletion have no distributed transaction; history writes log and return null on database error rather than failing the cycle. Evidence: `backend/index.mjs:L724-L754`, `backend/index.mjs:L1530-L1530`, `backend/index.mjs:L1774-L1774`, `backend/index.mjs:L1895-L1919`; `backend/lib/historyStore.mjs:L161-L164`, `backend/lib/historyStore.mjs:L205-L207`. Actual failures are **UNVERIFIED**.

## Retention, backups and recovery

History API defaults paginated limits and caps at500 (`backend/lib/historyStore.mjs:L211-L220`); full exports materialize all rows (`backend/lib/historyStore.mjs:L372-L393`). At startup or archive endpoint, retention defaults365days: collect expired records, write JSONL under DB-directory `archive/`, then delete both tables in a transaction (`backend/lib/historyStore.mjs:L400-L439`; `backend/index.mjs:L2918-L2924`, `backend/index.mjs:L2967-L2976`). Filesystem export and SQL deletion are not one atomic operation; a crash can leave duplicate archive evidence, and disk durability was not tested.

Settings packages include version, domain payloads, checksum and optional HMAC; explicit includeSecrets can include decrypted secrets (`backend/lib/settings/backup.mjs:L36-L81`). Pre-reset/import backups and restore are settings-level mechanisms, not whole-SQLite backups (`backend/lib/settings/service.mjs:L417-L483`, `backend/lib/settings/service.mjs:L529-L619`). Path containment currently uses string prefix checks (`backend/lib/settings/backup.mjs:L94-L108`). The persistent random session signing file has owner-only intended mode; its contents were excluded (`backend/lib/sessionSecret.mjs:L32-L43`). Calibration/legacy config persistence paths are indexed separately in the database manifest; actual backup/capture/config contents were excluded.

## Manifest schema, dependencies and known limitations

[database-entities.json](manifests/database-entities.json) schema1 records `entities[]` with column definitions, indexes, source, logical relationships and query ownership; `filesystem_persistence[]` records source owners. SQL expressions are schema only, not records. Dependencies: better-sqlite3, synchronous filesystem APIs, settings normalizers/registry, production queue and external vision cleanup client. Sessions DDL, live schema versions, lock contention, backup recoverability, data size and historical integrity are **UNVERIFIED**. The relationship diagram intentionally labels links as logical rather than enforced foreign keys.


## Related documentation

[Backend](04-BACKEND-ARCHITECTURE.md), [API](05-API-REFERENCE.md), [database diagram](diagrams/database-relationships.mmd), [risks](17-TECHNICAL-DEBT-AND-RISKS.md).
