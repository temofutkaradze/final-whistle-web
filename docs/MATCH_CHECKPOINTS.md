# Match listing and two-stage delivery

Prepared locally; no production database migration or service activation has been performed.
The migration has been applied only to disposable synthetic PostgreSQL test databases.
Apply `prisma/match-checkpoints.sql` only with explicit database approval, after backup
and schema review. Generate the Prisma client and update bot and worker code together.
Do not run this worker against the old schema. No environment variables are added.

`/matches` retains its existing current-day API cache fetch and includes cached fixtures
inside the configured local day or whose scheduled kickoff is within the last four
hours, inclusive. The extra window uses PostgreSQL only; it never fetches an extra API
day. `DISPLAY_TZ` still defaults to Asia/Tbilisi. Filters, fixture buttons and background
assignment are unchanged. Fixtures absent from the cache cannot be added by this window.
Visibility uses kickoff timestamps, not the UTC cache's `Match.day` label, so a cached
local-day fixture remains visible after four hours while an older previous-day fixture
does not leak through a UTC/local date mismatch.

The worker still ticks once per minute, starts checking at 107 elapsed wall-clock
minutes, checks at most every minute and expires selections after 24 hours.
Only its existing status response can record the first live checkpoint: `2H` or `ET`,
actual playing minute >=90 and two valid scores. HT, BT, P, generic LIVE without a
phase, and terminal statuses are ineligible. Extra time is live; FT/AET/PEN remain
final exactly as before. The snapshot is frozen; a later selection never replays it.
No photo at exactly 90:00 is guaranteed. FT on the first check produces only the final.

The start is 107 minutes and normal status checks now run every minute: 107/108/109...
(subject to worker ticks and cached check times). Per-UTC-day batching and the daily cap
remain unchanged. API failures retain the existing 10/20/40/60-minute backoff; one-minute
normal checking does not make failed requests retry every minute.
A single isolated fixture becoming FT at elapsed minute 119 now takes 13 status checks,
versus two under the original 110/10 schedule or three under 107/10. With one active UTC
day this can use approximately 60 status requests per hour, versus approximately six
with ten-minute checking. Other API calls consume the same daily quota. Multiple UTC
days can require separate requests; batching and errors affect actual usage. No new
polling loop, live-event request or event-fetch policy is introduced. At 107
elapsed minutes, actual playing time can still be below 90: wait for the next scheduled
check rather than fabricating a checkpoint.

Live renders use that observed score with empty event HTML; no event requests are made.
Final event fetching, templates, branding, backgrounds and document delivery remain
in place. Captions identify `90+ Live Checkpoint` and `Full Time`. Rendering filenames
include user selection and stage. Final processing always precedes live processing.
Live failure never changes the selection's final status or attempts.

Conditional claims and per-stage durable dispatch fences prevent concurrent/restarted
workers from dispatching the same stage twice. Pre-dispatch render failures retry;
explicit Telegram rejections release the fence and retain existing retry/backoff.
A network failure after dispatch (or crash before saving success) is intrinsically
ambiguous: Telegram offers no idempotency key. Automatic resend is suppressed; inspect
the authorized chat and reconcile manually. This favors no duplicates over guaranteed
delivery. No automatic fence reset is provided. Stale pre-dispatch claims recover after
15 minutes; dispatched claims become uncertain/failed without resending. An uncertain
live stage still permits final delivery. Deselection after dispatch retains a tombstone
and reselecting preserves fences; reselect time prevents historical live replay.

## Reproduce isolated PostgreSQL validation

With installed PostgreSQL 16 binaries (no downloads or application connection required):

```powershell
node --max-old-space-size=128 scripts/quality/verify-match-checkpoints.mjs --pg-bin 'C:/Program Files/PostgreSQL/16/bin'
```

The opt-in harness requires 448 MiB available RAM, uses a unique temporary cluster and
loopback port, ignores application/PG connection variables and starts no Final Whistle
services. It recreates the pre-change schema from commit `a56a757`, seeds synthetic data,
and verifies preservation, schema equivalence, rollback and lock timeout behavior. Real
Prisma worker tests use stub rendering/Telegram only. The cluster is stopped afterward;
the report is saved privately under `preview-images/match-checkpoints-validation/`.

Validated on PostgreSQL 16.11: all 16 tables' original columns/rows and indexes were
preserved, including 1000 selections and their timestamps, statuses and backgrounds.
All eight checks passed: safe defaults, current Prisma schema equivalence, repeat-run
rejection, transactional rollback after an injected failure, five-second lock-timeout
rollback, real-Prisma concurrent delivery/restart behavior and retained dispatch fences.
The measured migration was 51.54 ms; the contended lock timed out at 5017 ms. These are
small synthetic-test measurements, not production-scale guarantees. The tested LF SQL
file SHA-256 is `a59fc4d219d61946a3df1a8db245b6104f84b09a9fca6c81e74b23df30107539`.
No live database credentials, Football API calls or real Telegram sends were used.

## Production activation (separate explicit approval required)

1. Review and approve the PR, exact migration checksum, database identity and a maintenance
   window. Check actual server PostgreSQL version, schema baseline, selection row count,
   long transactions, available disk/WAL space and backup/restore readiness. Synthetic
   tests cannot establish production table size, drift or lock duration. The migration
   takes ACCESS EXCLUSIVE locks and backfills all selections; a large deployment may
   require a separately reviewed batched migration. Never increase timeouts blindly.
2. After restart/maintenance approval, gracefully stop and drain only Match manager and
   Match worker. Verify their process locks are released and no in-flight dispatch remains.
   Inspect/reconcile old `SENDING` selections before proceeding: the old worker had no
   durable dispatch fence, so historical delivery cannot be inferred from the migration.
   Do not run old and new workers together or start the new worker against the old schema.
3. Configure an approved libpq service privately (`PGSERVICE=final_whistle_production`)
   and password-file authentication; never put a credential URL in a command/log. This
   is an operator prerequisite, not configuration created by this change. Read-only
   identity check: `psql -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_user, version();"`.
   Ensure this is the explicitly approved target before any write.
4. Create and verify a restorable backup, e.g.
   `pg_dump --format=custom --file=C:/private-backups/final-whistle-before-checkpoints.dump`.
   Use an existing access-restricted backup directory outside the repository. Record old
   columns/row counts, selection timestamps, constraints and indexes for comparison.
5. From the reviewed release checkout, verify the approved SHA-256 with
   `Get-FileHash -Algorithm SHA256 prisma/match-checkpoints.sql`. Apply exactly once:
   `psql -X -v ON_ERROR_STOP=1 -f prisma/match-checkpoints.sql`.
   Stop on any error. The transaction rolls back on connection close after failure;
   confirm rollback before retrying. No `db push`, schema reset or destructive commands.
6. Verify all original values/counts, `selectedAt = createdAt` for legacy selections,
   `liveStatus = 'PENDING'`, `liveAttempts = 0` and null new dispatch markers. Compare the
   migrated schema to the approved Prisma schema and check existing foreign keys/indexes.
7. Install/build the approved code using the existing lockfile; generate the Prisma
   client (`npm.cmd exec -- prisma generate`), run typecheck/tests/build, then start exactly
   one Match manager (`npm.cmd run bot`) and one Match worker (`npm.cmd run worker`) with
   existing credentials/configuration. Existing renderer protocol/templates are unchanged.
   Do not restart unrelated News, website or renderer services as part of this feature.
8. Monitor startup/schema/lock errors and the 107/1-minute schedule and quota usage. With
   separate messaging approval, verify one selected match's live/final documents and
   captions, user-specific branding/background, and restart deduplication. FT on the first
   check must yield only final. Never issue extra API requests to force a checkpoint.

If activation fails, stop Match processing and investigate. Keep additive columns and
dispatch receipts intact; never drop/reset them to retry. Before rolling back worker
code, reconcile all in-flight/uncertain stages (old code does not honor new fences).
Restore a database backup only under a separately approved recovery plan, since it
would also revert unrelated writes made after the backup.
