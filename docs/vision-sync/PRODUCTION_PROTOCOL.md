# Vision production synchronization

The Master and Vision Slave support a versioned production grant and run
protocol. Setup and Initialization cannot issue a grant.

## Admission contract

The Slave pulls the selected recipe, applies it locally, and reports the exact
session, selection, recipe, local revision, and ledger identity. The Master
verifies the current Slave boot through its authenticated capabilities endpoint.
Only a ready, idle, matching acknowledgement can receive a 10-second grant.
The Slave must acknowledge installation before the Master permits a production
start. Busy, changed, expired, disconnected, or unacknowledged state removes
authority for another run.

Normal production also requires proof that the current reference selection was
sent to every enabled weld/shrink serial destination. This proof is tied to the
selection revision and is lost on a service restart or another load. A missing
adapter or failed write blocks Start even when the camera grant is installed;
reconnect the correct adapter and scan the reference again. Mechanical dry
cycles do not use this production serial-delivery gate. A reference with both
barcode-send options disabled, such as AAAA, requires no serial delivery.

Before the camera step, the Master creates a durable run ID and request in
SQLite. It sends the request once to `/api/vision-sync/runs`, then looks up
that exact run ID and ledger ID until a terminal result is recorded. A lost POST
response is never retried. Any unresolved run blocks the next production start
until an exact lookup reconciles it. Commissioning's mechanical-inspection
diagnostic remains separate from this production path.

## Configuration

Configure separate, private 32-character-or-longer credentials in the Master
and Slave environment files. The Slave-to-Master credential is
`VISION_SLAVE_TO_MASTER_TOKEN` on the Slave and either the same token or its
SHA-256 fingerprint on the Master. The Master-to-Slave credential is
`VISION_MASTER_TO_SLAVE_TOKEN` on both. Set the Master to
`VISION_SYNC_AUTH_MODE=bearer`, `VISION_SYNC_MODE=production`, and the Slave to
`VISION_SLAVE_SYNC_MODE=production` with `VISION_MASTER_URL=http://192.168.10.1:3333`.
Keep `PRODUCTION_SKIP_VISION` unset and do not select the legacy Vision engine.

After a controlled service restart, verify the Master init-status reports a
loaded and initialized reference, `canStartProduction=true`, and no
`productionBlockCode`. The Slave synchronization status must report current
execution authorization for the same reference. If it does not, resolve the
specific issue instead of running Setup repeatedly. The soak script exits
before Setup on `VISION_SYNC_COMMISSIONING`,
`VISION_SYNC_PRODUCTION_NOT_READY`, or
`VISION_SYNC_RUN_RECONCILIATION_REQUIRED`. It also exits before Setup on
`REFERENCE_SERIAL_NOT_DELIVERED`.
