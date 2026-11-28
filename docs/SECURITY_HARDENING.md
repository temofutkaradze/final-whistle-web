# Local multi-user security hardening

This document describes local changes awaiting final verification and publication. No services are started by the hardening tools. No runtime database role is activated automatically.

**Current handoff:** see [PROJECT_STATUS.md](../PROJECT_STATUS.md). Earlier verification checkpoints below are historical. The approved TelegramMember and MatchDeliveryReceipt migrations are installed; current role/grant changes remain proposal-only.

## Windows files and recovery

`scripts/harden-local-acls.ps1 -Apply` records each application's existing DACL under `storage/security-backups/acl-<timestamp>.json` before changes. It writes **DACLs only**, preserving owners, groups and audit settings. Application roots, source, launchers, render assets/output, storage, backups and existing build files receive protected ACLs for the current Windows account, SYSTEM and Administrators. New files inherit their parent's restricted rules. Junctions and dependency/Git directory traversal are skipped; no unrelated directories are targeted.

The verified recovery record for this run is `storage/security-backups/acl-20261127-235321.json`. From this checkout, while services remain stopped:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/harden-local-acls.ps1 -Restore C:\final-whistle-web\storage\security-backups\acl-20261127-235321.json
```

Recovery deliberately restores the previous, broader permissions. The source baseline is retained under `storage/security-backups/source-baseline-20261127/`; do not restore it wholesale over later work. No environment-file content is copied to that source snapshot. Existing private database backups are retained.

ACL protection is not encryption. The latest receipt-migration dump is EFS-encrypted, but no independent EFS recovery export has been verified. Older backups remain ACL-protected. The prepared independent recovery workflow below uses established 7-Zip AES-256, not custom cryptography. No old backup is removed or overwritten. BitLocker remains a separate owner/OS decision.

The renderer process alone redirects TEMP/TMP/TMPDIR to restricted `storage/renderer-tmp` before loading Playwright. Browser scratch profiles no longer depend on shared temporary-folder permissions. Playwright retains its normal profile cleanup; crash leftovers are retained privately rather than automatically purged. Other programs' temporary directories and Windows environment settings are untouched.

## Local website and authentication

Both `npm run dev` and `npm start` explicitly bind to `127.0.0.1`. The renderer remains loopback-only and requires the existing render secret. Telegram uses outbound Bot API polling; no webhook, tunnel, public port or personal Telegram client is introduced.

Public password signup and new Google-account registration are disabled unless `FW_ALLOW_REGISTRATION=true` is explicitly set. Existing password accounts and verified Google subject bindings continue to authenticate. No account or session is deleted. OAuth still uses the configured APP_URL or request origin: consistently use the existing configured hostname (`localhost` or `127.0.0.1`), since cookies and Google callback registrations are hostname-specific.

Proxy generates a fresh CSP nonce, overwrites untrusted request nonce/CSP headers, and provides the policy to Next.js and the response. The existing theme script receives the nonce. Inline event handlers are prohibited; existing inline styles remain allowed to preserve the editor. Development alone permits eval and loopback WebSockets. Pages are dynamically rendered, as required for request nonces. No local TLS certificate or firewall change is made.

## Logs

Bot/worker/renderer entry points and Next.js instrumentation install the central formatter in `scripts/lib/security-log.cjs`. It removes configured secret values, registered decrypted bot tokens, credential-bearing URLs and encrypted-token strings before console logging. Telegram image error replies use the same redactor. Redaction is defense in depth, not permission to deliberately log sensitive objects. Native crash reports and third-party output outside these entry points are not guaranteed to be covered.

## Scheduling and resource budgets

Each bot manager has a bounded scheduler: at most two active conversations, one active delegated conversation, eight queued updates per conversation and 64 queued updates total, with eight queue positions reserved from delegated saturation. Conversation order is preserved. An owner lane remains available while a delegate awaits rendering. Owner preference is bounded so delegates receive turns. Overflow leaves the update unacknowledged and asks the sender to retry; unauthorized spam replies remain throttled. The Telegram offset advances only for the completed prefix of queued work, so later users completing first cannot skip earlier updates. Work holds its scheduler slot through cursor persistence. Shutdown/lock loss cancels unstarted work without advancing the cursor; accepted but unfinished updates replay after restart. No extra pollers or processes are introduced. Running jobs cannot be preempted. Automatic Match work stably prioritizes owners among eligible selections, without changing eligibility, monitoring intervals or live/final rules.

The shared renderer still permits two active renders, now at most one delegated render, and four queued requests. Owner requests have priority, with bounded fairness. Trusted application calls pass an owner flag and a hashed principal key alongside the existing renderer authentication. Bot users cannot supply those HTTP headers. Existing direct API clients retain their compatibility path.

Restrictive limits are **proposed, not activated without owner approval**. `FW_ENFORCE_DELEGATE_QUOTAS=true` enables:

| Budget | Proposed value |
| --- | --- |
| Delegated rendered images | 4/minute, 40/hour per principal |
| Delegated renders across both bots | 120/hour in the shared renderer |
| Delegated persisted Match uploads | 250 MiB per principal |
| Free disk reserve | 2 GiB |

An image in an album costs one render. Owner renders are exempt from those restrictive quotas. Counters are bounded and process-local; they reset on restart. Upload storage totals are measured from existing owned file prefixes without deleting files. Emergency free-space guards protect new Match uploads (64 MiB plus upload bytes) and renderer admission (128 MiB), even with restrictive quotas disabled. Existing 15 MiB upload, 25-million-pixel image bounds, HTTP deadlines, API-Football daily budget, and standings provider caching/rate limits remain in place.

Unauthorized authorization replies are bounded to one per identity/minute and ten/minute per router. This limits replies, not all database lookup cost. The separately approved apply-mode maintenance policy is documented in [STORAGE_MAINTENANCE.md](STORAGE_MAINTENANCE.md); permanent media and uncertain dispatches remain protected.

## Database and revocation

Delegated private reads and writes enforce principal ownership and current membership/version. Nested private relations and arbitrary raw-query capabilities are denied. Transaction callbacks receive scoped clients, including background assignment. Only the internal authorization capability can read owner credentials; these remain transient and are never copied to delegate records. Shared football tables remain readable without allowing relation expansion into other users' selections. Match selection callbacks derive a desired state from the original button and apply that state idempotently, so replay cannot toggle a selection twice.

Telegram document delivery supports a fresh authorization callback **after reading image bytes and immediately before HTTP dispatch**. Worker, manual and delegated deliveries use it. News persists per-update conversation markers and the render job before rendering; a replay resumes that render, and sending/delivered markers prevent an automatic second file send when Telegram's result is ambiguous. For an album interrupted after a send has started, remaining files may require the user to resend the album after checking what arrived. Telegram has no idempotency key: a process failure after an external action succeeds but before the durable cursor commits can still leave an ambiguous delivery or repeat a non-idempotent external effect. Match selection callback intent is idempotent; exact-once delivery across a crash cannot be guaranteed.

Remote PostgreSQL connections explicitly use `sslmode=verify-full`; insecure TLS environment overrides are rejected for remote connections. Loopback-only test databases remain supported. Prisma tooling optionally uses `MIGRATION_DATABASE_URL`; existing DATABASE_URL remains the fallback.

`prisma/security-runtime-role-proposal.sql` is a **non-executed proposal**. It creates a NOLOGIN, non-owner, NOBYPASSRLS role with schema usage and explicit application-table DML only. Existing `neondb_owner` becomes migration-only after separately approved credential separation. Before activation, verify the exact database, secure password provisioning, authentication, user management, worker reads/writes, PostgreSQL advisory locks, cleanup transactions and future-table grants in an isolated database. No production roles, grants, credentials, schema or rows were changed by this hardening task. RLS is not enabled; application ownership checks remain essential.

## Renderer containment

Chromium launches with `chromiumSandbox:true`; failure does not retry without sandboxing. Browser child environment variables exclude database, bot and API credentials. Downloads and service workers are disabled in normal Match and News contexts. Templates, fonts, gradients, image-export algorithms, viewport dimensions and PNG settings are unchanged.

A Windows restricted renderer identity remains a proposal requiring approval. It would need read/execute access to renderer code, dependencies and fonts; tightly scoped write access to cache/output/profile directories; and read-only access to the required images. It must not read the main environment file, database credentials, user profile or backup directories. Provisioning an account, its renderer-only secret/configuration, and an alternate launch mechanism needs a separate compatibility test. No Windows account or service was created. Sharp still runs under the current application identity; Chromium sandboxing is not an OS boundary for all native decoding.

## Dependency patch

The Prisma versions are unchanged. A scoped npm override raises only `@prisma/config`'s Effect dependency to the advisory's same-major fixed version, 3.22.1. Installation uses `--ignore-scripts`. Validate Prisma CLI configuration and the generated client before publication. No downgrade or force-fix is used.

## Verification and startup

Run targeted tests sequentially and a TypeScript check. Sandbox smoke checks use a disposable browser with no HTTP server or Telegram requests. Full PNG comparisons and the production build require sufficient available RAM; do not lower safeguards or stop unrelated applications to force them.

Source/configuration changes invalidate the existing production-build fingerprint. **Do not start the production launcher until a new production build succeeds and the build guard verifies it.** End-to-end localhost login/OAuth, CSP hydration, bot polling and Telegram delivery need later manual verification; no running system is activated by these changes.

### Verification checkpoint (2026-11-28)

This subsection records earlier checks, not the current completion state. See the root status document for subsequent build, migration and verification results.

- Applied restricted DACLs to 4,513 application paths. Checked the environment file, source, scripts, background/output/backup storage and an installed dependency: no ordinary Users/Authenticated Users grants remain. A disposable recovery fixture restored the exact original DACL, owner and content successfully.
- Full sequential suite: 67 files passed, 888 tests passed and 1 skipped. The only first-run failures were signup/UI fixtures that assumed open registration; they were updated to explicitly enable that test-only mode, then the complete suite passed.
- Focused scheduling/recovery regression batches after cursor changes passed (184 tests), with a later 5-file callback/replay rerun passing 78 tests. They cover ordered completed-prefix checkpointing, interruption replayability, duplicate update suppression, News render-stage resume, idempotent Match selection callbacks, News/Match conversations, worker delivery fences and match timing/checkpoint fixtures.
- TypeScript checks for both project/test configurations passed at a checkpoint. A later final rerun was stopped before launch when memory was 194 MiB (320 MiB floor). Prisma validation passed after the Effect patch.
- Real disposable Chromium launched with sandboxing enabled; Windows process inspection found no `--no-sandbox` flag. A 64×80 PNG smoke capture passed. No application HTTP service was started.
- Full-resolution News pixel/export comparison completed for 14 outputs (Single, Circle Left/Right, both Breaking options, headline/subtitle, Large Headline Automatic, NEWS 1/2, Did You Know 1/2, Large Headline Manual at 128/160, and Branding). All were genuine 2160×2700 PNGs; every output's raw pixels matched the isolated actual-template capture, and Telegram document bytes matched. Results and PNGs are in ignored `storage/optimization-verification-1795813796227/`.
- The separate full-resolution Match template comparison stopped before capture at 238 MiB free, below its 448 MiB gate. A disposable verification script was prepared but not run. The production build was not started: the latest free memory was also below its 768 MiB gate. The production guard correctly rejects the stale build fingerprint. Do not force either check or terminate unrelated applications.
- Production dependency audit reports zero vulnerabilities after the scoped Effect 3.22.1 patch. No Prisma downgrade or unrelated dependency upgrade occurred.
- The image templates, font/layout generators, branding placement, event classifier and image-export implementation compare unchanged with HEAD. Real full-resolution before/after pixel verification remains pending.
- Existing local feature/configuration work is preserved. No production database roles/schema/data, Windows accounts/services or firewall rules were changed. No real Telegram messages were sent.

## Completion: database activation and rollback (activated; procedure retained)

Approved activation is complete: runtime uses `final_whistle_runtime` with explicit DML on all 18 tables and no administrative privileges or table ownership. The original `neondb_owner` remains the separately protected migration/rollback identity. The 33 isolated checks were reused and 28 production activation checks passed; existing data was preserved. See [PROJECT_STATUS.md](../PROJECT_STATUS.md) for the activation record. PUBLIC schema USAGE and database CONNECT/TEMPORARY remain as reviewed. The procedure below is retained for reference; do not rerun CREATE ROLE against the already activated role.

The [runtime role proposal](../prisma/security-runtime-role-proposal.sql) creates a new NOLOGIN/NOINHERIT/non-owner role, grants CONNECT, schema USAGE and explicit DML on all 18 required tables, and aborts if PUBLIC/inherited privileges would permit application-schema creation or database creation, or if it unexpectedly owns tables/has memberships. It does not revoke PUBLIC TEMPORARY: temporary tables are not administrative access or ownership of application tables. No default/future-table grants are added. Each later migration requires explicit grant review. Row isolation remains application-enforced; the runtime database login necessarily accesses every principal's tables and encrypted bot credentials.

[verify-runtime-role.mjs](../scripts/security/verify-runtime-role.mjs) runs without a server or production credentials: it generates the installed Prisma schema using a dummy unreachable URL and exercises SQL in the already installed PGlite tool. Tests cover schema-compatible reads/DML, rollback, row/advisory locks, maintenance and receipt upserts/deletes, denied role/schema/table creation, destructive DDL, TRUNCATE, protected fixture reads, and escalation. PGlite cannot verify a new Neon TCP login, connection-pool behavior, or an actual Prisma adapter under that login. Those are explicit activation checks, not claimed results.

After specific owner approval, with application services stopped:

1. Confirm the same direct Neon endpoint/database and make/verify a new protected backup. Keep all existing backups and receipts. Do not reset or push the Prisma schema.
2. Put the existing owner URL only in an ACL-protected, ignored `.env.migration` as `MIGRATION_DATABASE_URL`. Never put it in `.env.local`, `.env.production`, or other Next auto-loaded files. Keep runtime `.env` for the new restricted `DATABASE_URL`; do not change APP_SECRET or bot credentials. Until the switch is approved, leave the existing runtime URL unchanged.
3. Use native psql with verified TLS and its password prompt, not a password-bearing command argument. The existing trusted public CA bundle is `storage/private-backups/telegram-members-2026-11-27T18-45-16-586Z/trusted-roots.pem`. Example from this checkout:

   ```powershell
   $migrationHost = Read-Host 'Verified direct Neon hostname (not the pooler)'
   $env:PGSSLMODE = 'verify-full'
   $env:PGSSLROOTCERT = (Resolve-Path 'storage/private-backups/telegram-members-2026-11-27T18-45-16-586Z/trusted-roots.pem').Path
   psql -h $migrationHost -U neondb_owner -d neondb -W
   ```

4. In the approved administrative session, use `\i prisma/security-runtime-role-proposal.sql`, then `\password final_whistle_runtime` (interactive hidden entry), and `ALTER ROLE final_whistle_runtime LOGIN;`. Do not enter a literal password in SQL or save it in SQL history. A failed proposal aborts its transaction; investigate rather than bypassing its checks.
5. Authenticate in a **new** direct connection using `psql -h $migrationHost -U final_whistle_runtime -d neondb -W`; verify current_user, all required SELECT/DML privileges, no CREATE privileges/memberships/ownership, `SELECT 1`, and advisory lock/unlock. Use a rollback-only fixture transaction to verify DML/receipt/session operations. Then verify Prisma `SELECT 1`, own-model queries and a rollback-only fixture through the pooled runtime URL. Never use permanent production fixture rows. If any essential check fails, do not switch.
6. Update runtime `.env` securely with the restricted URI (properly URL-encode password characters); retain administrative connection details separately. Runtime bootstraps remove MIGRATION_DATABASE_URL, PGPASSWORD and PGPASSFILE; Chromium receives neither connection. Renderer parent uses a minimal environment. These controls do not protect against code that can read files as the same Windows account.
7. Build once after the approved environment/config changes, run both guard and trace verification, then let the owner start manually and check login/OAuth/User Management, both bots and worker housekeeping. Do not automatically send messages to verify activation.

Migration-only Prisma commands can explicitly load the separate file, for example `node --env-file=.env.migration node_modules/prisma/build/index.js migrate diff --from-empty --to-schema prisma/schema.prisma --script`. Never use unreviewed `db push`/reset. Administrative operations and new grants remain separately approved.

Rollback: stop services manually, restore the former runtime URL from the protected administrative configuration, rebuild because environment changes invalidate the guard, and verify before manual startup. Preserve all records, dispatch fences and receipts. Keep the restricted role for diagnosis; only with approval disable its LOGIN. Do not drop the role/table or perform wholesale database restoration as a routine rollback. Restoring a backup requires a separate disposable recovery database first.

## Completion: independent backup recovery (local verification completed)

Official 7-Zip 26.06 was installed during approved activation. The owner subsequently confirmed: AES-256/header-encrypted archive integrity passed; 50 files extracted successfully; all 49 manifest checksums passed; extracted ACL protection passed; the EFS recovery private key was verified in memory; no certificate was installed; no original backups or database records changed. These are confirmed local archive/PFX recovery results, not a full PostgreSQL restore or another-computer recovery test.

PowerShell 5.1 fixes: test/extraction calls omit bare `-p`, which would supply an empty password instead of prompting. JSON is assigned before array enumeration so each manifest path is a string. The recovery tool validates manifest fields, contained paths, reparse points and extracted ACLs; `-VerifyExtractedOnly` resumes verification without archive testing or extraction, provided the protected extraction still exists.

After owner approval, only the verified temporary extraction under `storage/recovery-exports/20261128-042850-8a2453bfb9634690a1b068afe110aca9/verification-resume-5697a06cb96d4dfca0f129febf1e2c9e/` was removed (50 files). Archive/PFX hashes were unchanged across cleanup and all 49 original manifest files remained present. Originals, exported certificate, encrypted archive and recovery tools were preserved. The removed extraction cannot be resumed; future recovery uses a new destination.

Copy the exact recovery set from [ONBOARDING.md](../ONBOARDING.md) to secure external storage. This off-device copy remains the owner's action. Keep passwords separately. Do not repeat already successful verification solely to update documentation.

For future new backup copies (not required for the already verified archive), run in an interactive PowerShell terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/security/protect-backups.ps1 -ExportEfsCertificate
```

Supply `-SevenZipPath` only if its approved installation path differs. The script refuses missing tools, linked source paths and an EFS-bound recovery destination. It keeps existing protected ACLs, creates new copies only, and prompts via native 7-Zip/cipher (never a password argument). Archive settings: 7z/AES-256, encrypted headers, one thread, 16 MiB dictionary, low compression. It exports the EFS certificate as a password-protected PFX only when explicitly requested, creates the encrypted archive outside the EFS-bound source tree, tests integrity, extracts into a new protected folder, compares every original/recovered SHA-256, and removes only that invocation's verified extraction. Any failure preserves originals and leaves protected diagnostic copies.

Store the archive on a separate device and keep strong unique archive/PFX passphrases separately (offline recovery record or trusted password manager). Never paste them into chat, source, .env, process arguments, logs or history. Verify recovery on another computer before treating disaster recovery as complete. The 7z copy contains decrypted source bytes inside its own portable encryption, so its recovery does not depend on the original EFS profile. The exported PFX separately protects recovery of the original EFS dump. If exporting only the EFS certificate before 7-Zip is available, use Windows' cipher /x interactive export into an ACL-protected non-EFS recovery directory; do not export it to an unprotected folder.

Database archive integrity was previously checked with pg_restore under the original Windows account. Actual complete restoration of production data to another PostgreSQL instance has not been run in this task. After extraction, verify `pg_restore --list`, then restore with `--exit-on-error --no-owner --no-privileges` into a **separate, empty, explicitly approved** recovery database and compare schema/counts before considering production recovery. No live database restoration, original-backup deletion, or account/system security change is automatic.

## Completion: polling, packaging and residual boundaries

Both pollers now fetch from the **persisted completed** offset while work runs. In-memory accepted IDs avoid double scheduling. This removes the earlier whole-batch render wait without persisting incoming payloads in a new inbox. Pending re-fetches are throttled to one/second; normal idle polling still uses the existing 25-second long poll. Conversations remain ordered, owner capacity remains reserved, and the independent automatic Match worker's timing is unchanged.

Telegram [documents](https://core.telegram.org/bots/api#getupdates) acknowledgment by requesting a higher offset, a maximum 100-update response, and at-most-24-hour retention. The selected design is a small-system tradeoff: crashes replay unfinished work within that retention window; long outages or a full unacknowledged batch can still delay/lose arrivals. Dispatch fences are never automatically retried merely to achieve apparent exactly-once delivery. An external Telegram send can remain uncertain. A future requirement for retaining fetched updates across longer outages would justify a database inbox, but not two competing inbox stores. News handling of update-ID reseeding after week-long inactivity is not verified; do not blindly reset deduplication/uncertain states.

The Next renderer client now imports filesystem-free security headers; resource-budget filesystem operations stay in runtime-only processes. Private-storage trace exclusions are defense in depth. [verify-sensitive-traces.mjs](../scripts/verify-sensitive-traces.mjs) checks ordinary and additional-root manifests, real paths and symlink/junction targets; it prints category counts only. Built-in logos/fonts remain allowed. It deliberately fails on stale/private/missing traces. The old build fails; only a fresh build can establish resolution:

Trace manifests list inputs; their presence alone does not mean those files are served publicly. The risk is accidentally copying private inputs into a packaged/standalone deployment. This task did not deploy or expose them.

```powershell
npm run build
node scripts/production-build-guard.mjs verify
node scripts/verify-sensitive-traces.mjs
```

Do not continue after a failure or manually invoke the guard's finish step. The existing launcher is unchanged. Renderer OS isolation remains incomplete: native Sharp and the Node renderer run as the current Windows account, despite credential minimization and sandboxed Chromium. A separate restricted renderer account would reduce filesystem blast radius but requires approval, scoped ACLs and launcher compatibility testing. No Windows account/service was created.
