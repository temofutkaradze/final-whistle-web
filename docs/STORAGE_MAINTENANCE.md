# Storage maintenance

Current local status (2026-11-28): the owner approved activation and `.env` is set to `FW_STORAGE_MAINTENANCE_MODE=apply`. The approved initial pass removed 38 safe temporary files and one expired Session. No further production cleanup was executed during security completion. The receipt migration has been applied and Prisma regenerated. Services remain stopped; later maintenance runs only when the owner starts them.

Maintenance runs inside existing lifecycle points; it does not add a service or render-time scan. The Match worker checks bounded candidates during its existing hourly housekeeping, the News manager checks its upload scratch directory after acquiring its existing singleton lock, and the renderer checks its private Chromium scratch directory after it successfully binds its loopback port and before Chromium warm-up.

`FW_STORAGE_MAINTENANCE_MODE` defaults to `dry-run`. The report command is always read-only:

```powershell
node --env-file=.env scripts/storage-maintenance-report.mjs
```

The report lists exact candidate paths and database row identifiers without returning News photo IDs, pending message content, credentials, or image bytes. The source default remains dry-run for new installations; local activation was separately approved. Each run is bounded to at most 25 filesystem deletions and 50 database rows per category; skipped, linked, uncertain, active, unreadable, and out-of-root items are retained for review.

## Retention rules

- Abandoned News uploads, renderer scratch profiles, and eligible failed/completed render artifacts: 24 hours. Only `storage/news-tmp`, `storage/renderer-tmp`, `render/rendered`, and `render/output` are eligible. The scanner rejects reparse points/symlinks and checks canonical paths. Renderer scratch is considered only at renderer startup before Chromium is created; News upload scratch is considered at News-manager startup before polling begins.
- A Match HTML source is proposed for cleanup immediately after Chromium returns that render's image. Match PNG/JPG files are proposed only after Telegram confirms delivery. In dry-run, helpers report candidates and leave them untouched. The hourly stale-file sweep also allows only terminal failures with no dispatch fence and cancelled renders; `SELECTED`, `SENDING`, retryable, dispatch-fenced, unknown file names, and missing receipts are retained.
- Match cache retention remains 48 hours. Unselected rows can be removed; terminal selections are archived to receipts first when the receipt table is available. Unresolved/active selections are retained. Batches use a rotating fixture-ID scan so retained rows do not indefinitely block later eligible fixtures; restart safely starts the scan over. User-uploaded backgrounds are never deleted.
- Expired Sessions and pairing challenges are listed in dry-run and, after explicit activation, removed in batches. News conversation states use the existing one-hour idle expiry. Clearing retains `lastAppliedUpdateId` in `pending` and leaves the separate `lastUpdateId` cursor, credentials, and settings untouched. An old `rendering` state is eligible only after its update is already behind the durable cursor; unacknowledged replayable renders, all `sending`/uncertain states, and unknown states are preserved.
- Existing FixtureDay and ApiUsage retention remains unchanged (72-hour date-key policy and seven-day API-usage policy), with bounded deletion batches.
- Capacity monitoring uses one `statfs` and one `pg_database_size` read during hourly maintenance. The local warning is 5 GiB free; the database warning defaults to 750 MiB and can be overridden with `FW_DATABASE_WARNING_BYTES`. Neither check blocks work.

## Match receipts (migration applied)

The additive schema in `prisma/schema.prisma` and `prisma/match-delivery-receipts.sql` was applied with approval on 2026-11-28. It stores user/fixture IDs, terminal final/live states, timestamps, dispatch fences and expiry, keyed by `(userId, fixtureId)`, with an expiry index and deliberately no Match foreign key. Housekeeping archives and verifies settled receipts before deleting their source rows in one transaction. Active/retryable rows, `SENDING`, dispatch-fenced failures and pending live checkpoint work remain. Row locks and an exclusive archival advisory lock protect this transaction. Manual renders take shared advisory leases (allowing two users to render the same fixture) and verify them before dispatch; a lost lease prevents sending.

Even apparently unselected old Matches are parent-row locked, checked for an active manual lease, and rechecked for new child selections before deletion. Both cleanup transaction paths explicitly use Read Committed isolation so the post-lock child read sees a concurrent insertion that committed before the lock was acquired. Normal eligibility and delivery timers are unchanged.

Thirty days exceeds the 24-hour selection retry window, 48-hour Match availability window and 15-minute stale-send recovery interval. Expiry starts on archival; unresolved dispatches are never archived or expired. The migration's five constraints, two indexes, owner privileges and unchanged counts in the 17 pre-existing tables were verified. Rollback must retain receipts and dispatch fences: these compact rows cannot recreate Match cache fields or Selection backgrounds. Do not drop the table while duplicate prevention relies on it. Unresolved counts are logged by housekeeping and require manual reconciliation, not age-based deletion.

## Permanent data excluded

Maintenance never walks or deletes `storage/backgrounds`, `storage/logos`, backup folders, security/ACL recovery data, templates, teams, accounts, permissions, credentials, subscriptions, active selections, or unresolved delivery state. Potentially orphaned saved assets remain report-only and require separate approval.
