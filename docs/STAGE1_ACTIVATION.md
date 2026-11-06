# Stage 1 release activation runbook

Updated 2026-11-06. DOCUMENTATION ONLY: no activation, database connection, migration, build, tests or service changes performed for this update. Scope: the main project, public multi-user operation. See [release checklist and exact untracked inventory](./RELEASE_CHECKLIST.md).

## Status and scope

NOT READY for production activation until the gates below are completed under separate approval. H1/H2 are prepared, not activated. R1-R4 and renderer operations remain part of the release; source preparation is not proof of live remediation. Earlier process IDs, connectivity observations and test counts are historical evidence, not current checks.

This runbook supersedes the old nine-file, no-migration rollout and source-only rollback. The release now includes additive authentication/pairing tables, dependency changes, generated Prisma Client requirements, background-file coordination and resource controls. Do not use the previous source subset or its insecure rollback instructions.

## Release gates

- Freeze an explicitly reviewed release manifest including required untracked runtime modules, assets/licenses, SQL and tests. Git currently contains substantial unstaged/untracked work; a tracked-files-only archive is incomplete. Do not include secrets, caches, Windows build dependencies or local user storage in the code artifact. Existing staged changes are not altered by this preparation.
- Separately approve and verify the two additive migrations below against the intended Neon project/production branch/database. No production verification is claimed here. Require a current recoverable backup/restore procedure and approved write permissions before execution. The earlier News migration backup waiver does not authorize these new migrations.
- Approve supervised H1 legacy recovery and disputed-credential/session decisions. There is no automatic backfill or recovery writer. Legacy Google-only users without subject bindings will fail closed; communicate the access interruption and recovery route before cutover.
- Prepare a security-safe complete rollback release. An older release with email-based Google linking or first-contact Telegram trust is not an acceptable active fallback.
- Build and validate the final frozen release in compatible deployment staging, including Linux ARM dependencies/Chromium if Oracle is the target. Prior focused tests are historical; no final combined release build or live verification is asserted by this document. Schedule the remaining deployment smoke checks once, not another audit.

## Database preparation: separately approved operations only

| SQL | Scope | SHA-256 |
| --- | --- | --- |
| [auth-identity.sql](../prisma/auth-identity.sql) | New public.AuthIdentity; unique provider/subject and user/provider; User FK and checks | 4FDD3E834334A174D0231C054848E34F6A1D648D3038D99714DA358B177548B4 |
| [match-pairing.sql](../prisma/match-pairing.sql) | New public.MatchPairingChallenge and public.MatchTelegramBinding; indexes, User FKs and checks | 358406E19907E4EFBD6B87867510594EDCAFEF9FA37244AF97F62481B2148D70 |

Both files are transactional, additive and contain no existing-user update/backfill. Recalculate hashes before execution. Verify public.User.id, expected types/constraints and absence of conflicting tables; stop on unexpected differences. Use a temporary least-privilege migration role with required CREATE/REFERENCES rights, not broader permanent runtime permissions. Verify constraints, unchanged existing records and new empty tables after execution. Never log rows containing private account data.

These are standalone SQL files, not an established Prisma migration history. Do not assume prisma migrate deploy applies them. Do not run db push, migrate dev, reset, or a generic installer. Apply only the exact separately approved files with stop-on-error behavior; each commits independently, so verify each result before proceeding. If the second fails, keep consumers stopped and inspect; do not drop the first table automatically.

[news-four-columns.sql](../prisma/news-four-columns.sql) records the previously completed NewsSettings upgrade; it is not a newly required migration. Later schema preflight must confirm compatibility, not blindly replay it. Shared background locking, quotas, admissions and cache retirement require no schema migration. Generate the matching Prisma Client in release staging after schema preparation; generation does not apply migrations.

## Account transition and delivery safety

Follow [H1 preparation/recovery](./H1_AUTH_PREPARATION.md) and [H2 pairing](./H2_MATCH_PAIRING.md).

1. Drain all authentication/session issuers before supervised recovery. Old OAuth callbacks must not remain active beside the new release. Existing sessions and email/password matches do not prove Google identity ownership.
2. Recovery needs fresh server-verified Google subject evidence, independent account ownership evidence, explicit consent and operator authorization for the exact user/subject. No email matching, NULL-password inference, silent merges or automatic binding. Resolve disputed passwords explicitly and revoke old sessions under a coordinated procedure so in-flight requests cannot reissue stale access. Preserve accounts/data and deny ambiguous claims.
3. Establish trustworthy website access before H2 confirmation. Legacy Match chat IDs remain untrusted. In a private chat, the user requests a short-lived code, enters it on the authenticated Match dashboard, reviews the Telegram identity and explicitly confirms. Hash-only, single-use challenges are consumed atomically; do not manually approve legacy IDs.
4. Review held legacy selections and uncertain SENDING jobs before enabling worker deliveries. Reconfirmation can resume retention/deadline handling; do not reset jobs or blindly resend uncertain Telegram deliveries.

## Exact activation order

All stop/start, migration, recovery and routing actions below require separate approval. Obtain fresh process/supervisor status first; never act on historical PIDs.

1. Prepare complete immutable release and verified rollback artifacts away from the live directory. Preserve external secret configuration and persistent data. Verify target dependencies, permissions, free disk/RAM, direct Neon session connectivity and existing webhook/polling ownership without exposing values.
2. Announce a quiet window. Gate website mutations/authentication and disable automatic relaunch. Stop News manager and Match polling intake gracefully, then drain/stop Match worker. Let admitted website/render jobs finish; then stop website and renderer gracefully. Check every role/host, including old supervisors and n8n polling conflicts. Do not delete Telegram webhooks or drop pending updates.
3. With old authentication issuers stopped, execute only separately approved H1 then H2 SQL and verification. Perform approved H1 recovery/session work under the drained-authentication procedure. Never run these steps as an implicit startup action.
4. Install/switch the WHOLE verified release, including its matching dependencies, generated client and Next build. Deploy the background locking changes to every bot/worker writer together; mixed old/new writers do not share the safety protocol. Deploy cross-generator bot registration and quota checks together. No old website/bot/worker process may remain active.
5. Start the authenticated shared renderer on loopback; verify health and exact client protocol/secret agreement. Retain persistent Chromium, final validation/manifests/CSP and resource restrictions. No Gotenberg.
6. Start ONE website process initially; verify password login, subject-bound Google login/new registration, collision failure, H1 legacy recovery outcome and session handling. Reopen approved website access only after checks pass. Per-process abuse/sample admission budgets multiply across replicas; do not assume a global distributed limit.
7. Start ONE Match manager with approved binding enforcement and persistent cursor storage. Perform H2 private-chat/dashboard reconfirmation. Keep the worker held until bindings, existing selections and uncertain deliveries are reviewed.
8. Start ONE Match worker with background locks and delivery protections. Verify an authorized test/sample and worker claim behavior. Do not retry a timed-out Telegram send automatically.
9. Start ONE News manager last, only after checking bot uniqueness, webhook/polling conflicts, direct session locks and persisted News state. Verify all four layouts and one approved Telegram round trip. The built-in BREAKING design intentionally changed; use its new preview/reference, not an old byte baseline.
10. Verify website navigation, Google callback, Match output, News output, request limits and authenticated renderer metrics. Record release/build identity, health results and manual outcomes. Monitor before closing the window.

Expected interruption is the approved quiet-window cutover plus migration/recovery and verification time. It is not measured on Oracle ARM; do not promise the old 3-10 minute estimate. Staging the build ahead avoids compiling while live services are stopped. Legacy recovery may require a separate, longer access restriction.

## Persistence and restart hazards

- Preserve cursor files, News conversation state, uploads/backgrounds, generated posts, fonts and all existing database records. Confirm the actual service account can atomically create/rename cursors. Keep the same persistent storage across releases; a fresh directory can replay updates or hide files.
- Checkpoint-before-dispatch can lose an interrupted in-flight update; a send accepted before completion recording is uncertain. Telegram queue retention is finite. Ask for a resend only after checking no result was delivered; never seed guessed cursors, clear queues or reset SENDING as rollout recovery.
- Background assignments and cleanup must use the same PostgreSQL advisory-lock protocol. Directory-confined cleanup deliberately retains unsafe/unknown paths and may leave orphans after failures. Do not add a broad file sweep.
- Manager singleton locks require direct, session-preserving Neon connections; transaction-pooled connections cannot substitute. Transaction-scoped quota/background locks are a different mechanism. Check connectivity later under an approved preflight; none was attempted here.
- Graceful renderer drain waits for admitted work; force-killing it is not a safe equivalent. Website Telegram deadlines do not prove a message was not accepted. No automatic retry on ambiguous completion.

## Whole-release rollback requirements

Before activation, record an explicit rollback release path/ID and SHA-256 manifest of the COMPLETE runnable artifact: application and worker source, package/lockfile, platform dependencies, Prisma schema/generated client, Next configuration and entire .next tree including BUILD_ID. Keep an independent recoverable database backup and protected persistent-data backup. A directory on the same disk is not independent disaster recovery. Never copy secrets into the release manifest contents or logs.

Verify backup completeness/checksums before cutover and test restoration in a separate staging directory. Do not rely on the historical nine-file source snapshot. Keep artifact and storage paths distinct and inspect symlinks/mounts so restoration cannot overwrite persistent user data.

Rollback sequence:

1. Gate traffic and stop intake/consumers, drain jobs, then stop website/renderer; disable supervisors. Record uncertain deliveries. Verify processes are stopped, not merely that ports are empty.
2. Select the exact previously approved SECURITY-SAFE release, verify every artifact checksum and platform/client compatibility, and restore into a NEW empty staging directory. Never overlay .next or node_modules, and never use mirror/purge commands against live directories.
3. Switch the complete stopped release directory/pointer only after staged verification. On Windows, moves are not one atomic transaction: move failed build/release aside, then move the verified replacement into an absent destination. If interrupted, keep services stopped, inspect both paths and reverify before resuming. Do not rebuild over recovery evidence. On Linux, an atomic release pointer switch still requires stopped/restarted processes with the correct working directory and shared storage.
4. Verify the restored whole tree/BUILD_ID/client and storage mapping before starting anything. Retain AuthIdentity, pairing tables/bindings, revoked-session decisions and approved credential recovery. No down migration, user deletion or database snapshot restore is part of application rollback.
5. Start renderer, website, Match manager, reviewed worker, then News, using the same gates above. The rollback release MUST preserve H1/H2, renderer security, duplicate-delivery protections and coordinated background locking. If no such artifact exists, keep affected routes/consumers disabled under an approved maintenance plan; do not restore vulnerable authentication, first-contact linking or an unlocked cleanup writer.
6. Require browser reload after build/action ID changes. Confirm a user action did not already complete before retrying. Preserve failed artifacts, cursors, posts and logs for diagnosis; do not undo legitimate activity that occurred after cutover.

No universal rollback command is supplied: service unit names, deployment directory/pointer, artifact paths and a security-safe previous release are not verified. Record exact commands for the selected host before approval; guessing them would make this runbook unsafe.
