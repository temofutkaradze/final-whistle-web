# Final Whistle project status — 2026-11-28

This is the current handoff. Earlier verification checkpoints are historical. The owner has approved publishing the completed project changes on `main`. The approved runtime role is activated. The owner manually started production and confirmed everything works correctly; the agent did not start or restart services.

## Current state

- Existing security controls remain: private-chat numeric-ID authorization, separate delegated principals, version/revocation checks, owner-only administration, scoped private models, authenticated PNG document delivery, loopback binding, nonce CSP, verified database TLS, secure logging, renderer sandbox/network/file restrictions, upload bounds and bounded queues with owner capacity.
- Local maintenance is **apply**; restrictive delegated quotas and public registration are **off**. Do not reactivate either opt-in setting.
- TelegramMember and MatchDeliveryReceipt migrations were applied in earlier approved operations. Production contains **18 tables**. Runtime now uses `final_whistle_runtime`; `neondb_owner` is preserved only for separately loaded migration/rollback tooling.
- Owner-confirmed final production build and build guard passed (local success marker: `WHJAwDvyB2PIPsT5tJdBu`). Final sensitive traces: `{"manifests":18,"blockedFiles":0,"categories":{}}`. The owner manually started production and confirmed correct operation. These results are reused, not rerun for publication.

## Final owner confirmation and publication handoff

- Manual production build, production-build guard and sensitive-trace verification all succeeded after the targeted Turbopack trace-target resolution fix. The verifier still rejects private files and genuine outside-project references.
- Owner confirms the running production system works correctly. No agent service changes, new renderings, database operations or repeated successful tests/builds were needed for final publication.
- Owner confirms the encrypted recovery materials were copied to external USB storage. Archive integrity, 50-file extraction, 49 checksums, ACL protection and in-memory EFS private-key verification passed previously; originals were preserved and only the authorized temporary extraction was removed.
- **A full PostgreSQL restore and recovery on another computer were not tested.** USB copying is confirmed by the owner; it is not a second-computer recovery test.
- Final publication includes intended source, tests, additive SQL definitions and documentation only. Runtime/migration credentials, private storage, backup archives, PFX files, generated output and local-only installer/review/preview files remain excluded. Existing running services are untouched.

## Approved security activation — 2026-11-28 (current; supersedes pending items below)

- Activated `final_whistle_runtime` in the verified existing Neon `neondb` database. Explicit SELECT/INSERT/UPDATE/DELETE on all 18 tables; no ownership, memberships, schema CREATE, superuser, database/role creation or BYPASSRLS. The original migration owner is preserved. Public TEMPORARY remains as reviewed.
- Fresh pre-change backup: `storage/private-backups/runtime-role-2026-11-28T04-17-55.832Z/`. Complete custom archive decoded successfully with pg_restore; SHA-256 `0c5956eb055ddb8589205e5c6d4c837b4064d12927ede453bf124564ec17ad85`. Protected `.env` rollback copy, table counts/content checksums and original grant metadata are retained. Existing backups are untouched. EFS and restricted ACLs protect this copy; full restoration into another PostgreSQL instance is not claimed.
- Reused the 33 isolated permission checks. **28 additional production activation checks passed**, including all-table read/DML grants and TRUNCATE denials, rejected administrative operations, actual two-backend shared/exclusive advisory locks, pooled Prisma receipt/session/user operations rolled back, and unchanged counts/checksums across all 18 tables. No fixture records remain.
- Runtime `.env` now uses the restricted login; `.env.migration` stores only the preserved administrative tooling URL and is excluded from Git. New Windows files do not honor POSIX mode bits: a post-create ACL check found the migration file inherited broader access, corrected immediately to match `.env`. The activation helper now restricts an empty file before writing credentials. Both credential-file ACLs are verified.
- A fresh process using the actual runtime Prisma module verified the new role and receipt reads. Client TLS certificate verification and TLS 1.3 passed. `pg_stat_ssl` behind Neon's pooler describes its internal backend connection, not the client TLS socket; that initial diagnostic was corrected to inspect the actual authenticated TLS socket. Separate administrative login was verified without executing DDL.
- Installed official x64 **7-Zip 26.06** via the download linked from `https://www.7-zip.org/download.html`. Installer SHA-256 matched official `ip7z/7zip` release asset digest: `9b697f65ecc2d9b0152f5ee96d72dde522a7827690349d9307935dacf40f42ec`. Installer is unsigned; verification was official-source HTTPS plus the matching official release digest. Installed executable reports 26.06.
- Owner-confirmed backup recovery verification completed: AES-256/header-encrypted archive integrity passed, all 50 files extracted, all 49 manifest checksums passed, extracted ACL protection passed, and the EFS recovery private key was verified in memory. No certificate was installed; original backups and database records were unchanged. Password handling and JSON enumeration were corrected for Windows PowerShell 5.1. The owner also confirms the encrypted recovery materials are on external USB storage. This is **not a full PostgreSQL restore or recovery on another computer**.
- With owner approval, removed only the 50 files in `storage/recovery-exports/20261128-042850-8a2453bfb9634690a1b068afe110aca9/verification-resume-5697a06cb96d4dfca0f129febf1e2c9e/` and its temporary directories. Before deletion, verified the exact contained path, absence of reparse points, and presence of all 49 original manifest files. Archive/PFX SHA-256 values remained unchanged across cleanup; all original manifest files and recovery instructions remain present. No successful archive extraction, checksum verification or database operation was repeated for cleanup.
- Newly added operational files: [prepare-runtime-backup.mjs](scripts/security/prepare-runtime-backup.mjs), [activate-runtime-role.mjs](scripts/security/activate-runtime-role.mjs), [recover-backups.ps1](scripts/security/recover-backups.ps1). The first two are one-time approved activation tools, not startup hooks; do not rerun against the activated role. Documentation updated here and in [ONBOARDING.md](ONBOARDING.md).
- No application/rendering/polling/timing code changed in this activation. Restrictive delegated quotas remain off. No services, messages, build, deployment, commit or push were performed. Private credentials, backups and recovery exports are ignored by Git.

### Remaining manual actions and readiness

1. External USB copying is owner-confirmed complete. Keep archive/PFX passwords separately. Another-computer recovery and a full PostgreSQL restore remain untested; do not recreate the existing verified archive just to repeat checks.
2. Final build, guard and zero-blocked sensitive traces are owner-confirmed complete. For future source/configuration changes only, rebuild and verify before manual startup; never manually bless the guard.
3. The owner already started production and confirmed correct operation. No further startup or restart is required for this documentation/publication task.
4. Rollback if required: stop services manually; restore `.env` from this protected backup's `runtime-before.env` (preserving restricted ACLs), rebuild and verify before restarting. Administrative account remains valid. Preserve receipts/data and the new role; disabling it needs deliberate administrative action. Never perform wholesale database restoration as configuration rollback.

Remaining boundaries: application-enforced per-user isolation (no database RLS), native renderer uses the owner's Windows identity, Telegram's 24-hour retention/ambiguous external sends, and News week-long update-ID reseeding remain as previously documented. No separate durable inbox or Windows renderer account was added.

## Completed in this task

- Bot polling can fetch newly arriving commands while accepted jobs run, using only the persisted completed offset. Pending re-fetches are throttled to one per second. Accepted IDs suppress duplicate scheduling; shutdown drains/cancels work through existing checks. Match cursor file writes are flushed before atomic replacement.
- Retained the existing remote queue/cursor approach rather than adding a second durable store for two trusted users. No new table, inbox disk history, poller or service. PostgreSQL inboxes add per-message writes/schema/retention; a protected local inbox adds locking, crash journaling and uncertainty states. Neither is needed to remove the immediate head-of-line render delay.
- Manual renders now use **shared** receipt leases; archival retains an exclusive lock. Lease loss blocks dispatch, and authorization errors cannot leak the lease connection.
- Cleanup rotates bounded fixture-ID batches, retaining unresolved rows without letting the same first 50 rows starve all later safe candidates. Previously unselected Match deletion also had a preflight-to-delete race: it now locks parent rows and obtains the exclusive archival lease, then rechecks children in a Read Committed transaction, so a newly committed Selection cannot be cascaded away. No production cleanup was run here.
- Renderer parent environment now excludes unrelated credentials; bot/worker/website runtime startup removes administrative-only migration/psql credentials. Normal runtime secrets and render configuration remain available where required. This is defense in depth, not an OS identity boundary.
- Runtime-role proposal covers all 18 tables and aborts on dangerous inherited CREATE permissions, memberships or table ownership.
- Added private-path trace exclusions and a checker supporting the installed Turbopack file/link manifests. Existing stale build scan found **2,667 unique blocked paths** (2,324 private-storage, 81 backup/log/secret-extension, 259 temporary/backup and 3 outside-project references). Paths/contents were not printed. Fresh-build verification remains pending.
- Prepared interactive 7-Zip AES-256/header-encrypted backup copies, integrity/extraction/checksum verification, and optional password-protected EFS certificate export. No backup was altered or encrypted by this task.

## Verification ledger

- Mocked focused tests: **58 distinct tests passed across 8 files**: 31 polling/cursor/runtime-environment/trace, 16 receipt/manual-delivery, 5 existing Next configuration and 6 targeted worker cleanup tests. Changed shared-lease behavior was rerun with the cleanup/lease filter. Unrelated worker tests were skipped, not represented as new passes.
- Isolated PGlite: **33 checks passed** against the current Prisma-generated 18-table schema and proposed SQL grants: DML/read permissions, transaction rollback, row/exclusive/shared advisory locking, receipt upsert/cleanup and administrative denials. First test fixture incorrectly retained a superuser session identity; it was corrected to SET SESSION AUTHORIZATION. No production permissions changed. Cross-backend shared-lock concurrency was not exercised by this single-backend engine; mocked scheduling/concurrent-use protections and PostgreSQL shared-lock semantics underpin that change.
- Final project and test TypeScript checks passed. The initial test-only environment typing issue was corrected to accept generic environment records. The new SQL isolation option matches the generated Prisma enum.
- `git diff --check` passed using the repository's normal Windows line-ending configuration; no tracked private/environment/storage files were found. The production guard was executed and correctly rejected the stale build. No build marker was changed.
- Production read-only metadata: PUBLIC has schema USAGE only and database CONNECT/TEMPORARY; runtime CREATE isolation is feasible without changing existing PUBLIC grants. Actual network login/Prisma operation under the new role awaits approved activation.
- Current backup verification supersedes the earlier pending checkpoint: official 7-Zip is installed and the owner successfully completed integrity, extraction, all 49 checksums, ACL and in-memory EFS private-key verification. Temporary extracted files were subsequently removed with approval; archives/originals were preserved.
- ACL spot checks of .env, new security scripts, private DB and security-backup roots found no unexpected allow entries. Git ignores migration environment files, recovery archives, private backups and generated output. The isolated role test enforces a 320 MiB headroom gate; final TypeScript checks started with 599 MiB available. These are operation-specific safety gates/observations, not benchmarked universal memory minima.
- Reused unchanged results: prior 14-case full-resolution News verification, 76 worker timing/fence tests, 14 member-isolation tests, 7 maintenance tests, prior authentication/OAuth/admin tests and the production dependency audit reporting zero findings after the scoped Effect patch. No dependency files were changed this task; this is not a fresh advisory scan.
- No production build, live browser/auth/OAuth flow, real Telegram delivery, additional rendering or full regression suite was run.

## Remaining risks and decisions

| Severity | Practical issue / action |
| --- | --- |
| Residual database isolation | Restricted runtime role is activated and migration credentials are separate. It can read application tables; per-user isolation remains application-enforced. Protect both credential files. |
| Packaging safeguard | Final owner-run verification reports 18 manifests and zero blocked paths. Keep the guard and sensitive-trace checks for future builds. Historical stale-build findings are superseded. |
| Recovery limitation | Portable archive/EFS-key verification passed and external USB copying is owner-confirmed. Keep passwords separately; full PostgreSQL restoration and another-computer recovery are untested. |
| Medium, conditional native compromise | Renderer/Sharp still run as the owner's OS account. Environment restriction and Chromium sandboxing do not prevent every native-process exploit from reading same-account files. A separate restricted Windows renderer identity requires explicit approval and compatibility work. |
| Low, operational reliability | No durable inbox: Telegram retains updates for at most 24 hours. More than 100 unacknowledged updates or a saturated per-user queue can still cause backpressure. External sends have unavoidable ambiguous outcomes; do not auto-retry dispatch-fenced deliveries. |
| Low, prolonged inactivity | Telegram can reseed update IDs after a week without updates. Match has a persisted-cursor expiry; equivalent News cursor/marker epoch recovery is not verified. Avoid blindly resetting News markers or uncertain states; investigate if News stops responding after such inactivity. |

Pending/unresolved delivery counts are logged and retained for manual reconciliation. They can still grow; safe automatic deletion cannot decide whether Telegram delivered an ambiguous send.

## Exact next steps

1. Runtime-role activation, credential separation and official 7-Zip installation are completed. Keep administrative credentials only in the protected, explicitly loaded migration configuration.
2. Local encrypted archive/checksum/ACL/PFX verification and copying recovery materials to external USB storage are completed. Keep passphrases separately. No full PostgreSQL restore or another-computer recovery is claimed.
3. Final manual build, guard and zero-blocked sensitive-trace checks passed. Rebuild only after future source/configuration changes; never run `finish` manually.
4. The owner has manually started production and confirmed correct operation. Leave the running system untouched during GitHub publication.

Current assessment: **ready for normal manual production operation, with successful operation confirmed by the owner**. Database least privilege, local recovery verification and external USB copying are complete. Full PostgreSQL restoration and another-computer recovery remain untested; the residual security boundaries above still apply.

## Files changed in this completion task

- Polling/cursors: [poller.mjs](scripts/lib/poller.mjs), [ordered-update-cursor.mjs](scripts/lib/ordered-update-cursor.mjs), [update-cursor.mjs](scripts/lib/update-cursor.mjs), [news-bot.mjs](scripts/news-bot.mjs).
- Receipt/maintenance: [match-receipts.mjs](scripts/lib/match-receipts.mjs), [manual-match-post.mjs](scripts/lib/manual-match-post.mjs), [worker-core.mjs](scripts/lib/worker-core.mjs).
- Runtime environment: [runtime-environment.cjs](scripts/lib/runtime-environment.cjs), [declarations](scripts/lib/runtime-environment.d.cts), [runtime-security-bootstrap.mjs](scripts/lib/runtime-security-bootstrap.mjs), [bot.mjs](scripts/bot.mjs), [worker.mjs](scripts/worker.mjs), [render-server.js](render/render-server.js), [instrumentation.ts](src/instrumentation.ts).
- Privilege/recovery/packaging: [role proposal](prisma/security-runtime-role-proposal.sql), [role verifier](scripts/security/verify-runtime-role.mjs), [backup script](scripts/security/protect-backups.ps1), [trace verifier](scripts/verify-sensitive-traces.mjs), [next.config.mjs](next.config.mjs).
- Tests: [poller](tests/poller.test.ts), [ordered cursor](tests/ordered-update-cursor.test.ts), [manual delivery](tests/manual-match-post.test.ts), [receipts](tests/match-receipts.test.ts), [cleanup regression](tests/worker-core.test.ts), [security completion](tests/security-completion.test.ts).
- Documentation: [ONBOARDING.md](ONBOARDING.md), this file, [SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md), [STORAGE_MAINTENANCE.md](docs/STORAGE_MAINTENANCE.md).
