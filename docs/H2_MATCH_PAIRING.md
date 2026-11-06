# H2 Match Telegram pairing — prepared, not activated

Date: 2026-11-06. Main project only. No production datasource was queried, migration executed, live service stopped/restarted, environment changed or deployment performed. H1, R2 and Owner-Only Mode were not implemented or changed in this task.

## Root cause and authority boundary

The old Match handleStart bound the first chat to the website owner's bot. Ordinary text/uploads could reach it, and authorization compared only the saved chat ID. Groups/callback senders were not verified. User.telegramChatId and telegramLinkedAt therefore cannot prove website approval.

[Shared pairing/access helper](../scripts/lib/match-pairing.mjs) now separates a pending request from authority. Only an authenticated website account's explicit confirmation creates MatchTelegramBinding. Bot commands, text search, photos/documents and callbacks pass the shared private-sender gate before existing handlers run. Sender IDs must be positive safe integers, the chat must be private, sender ID must equal chat ID, and bot senders are rejected. Usernames, email, legacy links, and first contact grant no authority.

## Pairing flow

1. In the intended private Telegram account, send /start to the configured Match bot.
2. The bot issues a 32-random-byte base64url code, valid for ten minutes. Only SHA-256(code) is stored, scoped to account ID, bot ID, authenticated Telegram sender/chat and a hash of the current encrypted connection value. No plaintext code is stored in the database or logged.
3. Sign in to the website, open the Match dashboard, enter the code and choose Review Telegram identity. The server derives account ID from requireUser, not submitted fields. Review reveals only that account's current, unexpired request and does not consume or approve it.
4. Check the numeric Telegram identity and explicitly confirm the checkbox/button. The POST server action revalidates everything; client review state and submitted account IDs confer no authority. The code is not put in a URL. Next.js Server Action origin protections and the existing authenticated session remain required.
5. Under an account row lock, one transaction conditionally consumes the unexpired challenge, creates the unique binding, mirrors recipient/timestamp into legacy fields for compatibility, and invalidates other pending requests. A uniqueness failure rolls back consumption and recipient changes. Stale pending background staging is cleared, but its file is not deleted. Existing bot settings, accounts, brands and selections are retained.

One pending request per account/bot/sender, a 30-second rotation cooldown and a 50-request account cap bound active requests. Expired request rows are removed only when issuing another request. A new code invalidates the old one. These are new ephemeral rows, not existing account/post deletions. An approved binding cannot be silently replaced: use the existing authenticated disconnect/reconnect action, then pair again.

## Runtime integration

- [Match bot](../scripts/bot.mjs) captures bot ID and encrypted connection scope in each poller; stale scopes fail closed. Existing approved private commands, uploads, selection callbacks and help behavior remain. No polling process was started here.
- [Match dashboard](../src/app/dashboard/match/page.tsx), [server actions](../src/app/dashboard/match/pairing-actions.ts) and [pairing form](../src/app/dashboard/match/pairing-form.tsx) implement review/consent. Test sends use the approved recipient; sample sends recheck after rendering. Connect/disconnect invalidate challenges/bindings in the same account-locked transaction as bot configuration changes. Unverified wait-state auto-refresh was replaced with the explicit pairing form so drafts are not lost; confirmation revalidates the page.
- [Worker](../scripts/lib/worker-core.mjs) uses approved recipients instead of legacy chat fields, checks current authorization/connection before and after rendering, and rechecks notifications. Revocation during rendering returns the selection to SELECTED without spending an attempt or sending. Renderer, templates, dimensions/quality and persistent Chromium are unchanged.
- Unpaired pending selections are skipped by delivery/expiry. Cleanup retains their shared fixture and files rather than cascading away their pending work. After reconfirmation, existing match deadlines/retention resume; this does not guarantee delivery of already stale posts. Held work may increase storage until resolved. Existing general shared-background retention issues are not redesigned here.

Database checks cannot cancel a Telegram request already dispatched. Cutover must drain old workers/handlers; do not claim atomic revocation of already in-flight external sends. Real PostgreSQL row-lock/rollback behavior and live Telegram interaction still need separately approved disposable/live testing.

## Migration: unexecuted additive SQL

[Prisma schema](../prisma/schema.prisma) adds MatchPairingChallenge and MatchTelegramBinding plus inverse User relations. [Prepared SQL](../prisma/match-pairing.sql) was generated solely from local before/after schemas using an offline dummy datasource, then schema-qualified and wrapped in BEGIN/COMMIT with lock/statement timeouts. Local schema validation and Client generation passed.

The SQL creates only two empty tables, indexes, FKs and checks. Challenge hashes are unique; account/bot/sender pending slots are unique; approved bindings are unique per website user and bot. Private sender/chat equality, positive IDs, hash format and expiry are checked. There is no legacy approval, data copy, user/password/session modification, H1 table creation, or selection deletion. FK cascades apply only to later explicit parent operations. H1's existing prepared model was preserved, not included in this H2 delta.

Before separate execution approval: verify a recoverable backup, the exact target/schema public.User, User.id type/PK, absence of both new tables, required permissions and SQL checksum. Stop on unexpected differences. No IF NOT EXISTS hides conflicts. This repository uses standalone SQL; do not run migrate dev, db push/reset or assume migrate deploy applies this file. No automatic migration/startup command was added.

SQL SHA-256: 358406E19907E4EFBD6B87867510594EDCAFEF9FA37244AF97F62481B2148D70.

## Legacy reconfirmation and controlled rollout

All legacy links start untrusted; the migration inserts no approved binding. Private users reconfirm through the two-channel flow. Old group/shared chats cannot be approved; use a private account. Missing/ambiguous/conflicting binding state denies access and delivery. No background jobs, records or tokens are automatically removed as a legacy migration.

A separately approved rollout must:

1. Review the source, SQL, backup and account ownership/reconfirmation policy. Website authentication must be trustworthy; H2 does not repair H1's existing compromised accounts or sessions.
2. Choose a reviewed release snapshot. The working tree already contains unactivated H1/R2 work: deploying the entire current website would include it. H2 SQL does not create AuthIdentity. Do not unintentionally activate other prepared changes or bypass their migration/recovery/security gates.
3. Drain and stop old Match polling/worker processes under separate approval. Do not mix old first-contact handlers/workers with the new authorization gate.
4. Apply only separately approved migration(s), verify unchanged existing records and empty new tables, and generate matching Client/build artifacts. None of these deployment actions were performed here.
5. Start the reviewed website and one reviewed Match poller only after configuration/webhook/duplicate-instance checks and approval. Keep the worker paused while owners reconfirm and review legacy selections/backgrounds through their now-approved bot. Legacy first-contact activity may have changed those selections; this preparation preserves them rather than guessing which to delete.
6. Test rejected private/group/other-sender updates, review-before-consent, expiry/replay and one real authorized sample. Then separately approve starting one reviewed worker and check delivery to the approved private recipient. No /start is needed for each subsequent post.

## Rollback

Keep the additive tables and approved bindings; never reverse recovery or restore untrusted legacy fields as authority. Restore a complete reviewed application/build/Client set, not mixed Next.js build output. A version that trusts first contact or only telegramChatId is not a security-safe rollback.

If no verified authorization-preserving rollback release exists, leave Match polling/worker and Match send/pairing actions disabled until the safe release is restored. Those service/routing actions require separate approval; none occurred here. Do not drop the new tables, auto-approve legacy bindings, delete queued selections or reset uncertain SENDING deliveries. Inspect any in-flight/uncertain delivery before restarting to avoid duplicates.

## Validation and changed files

74 distinct focused tests passed across match-pairing, match-pairing-actions, match-pairing-migration, match-dashboard, worker-core and poller. Development runs passed 61 tests, then 42 tests after adding further coverage (the worker suite overlaps). Tests use fake Telegram, mocked website sessions and an in-memory serialized/rollback-capable database; no production database or Telegram bot was contacted. Coverage includes first-contact denial, private sender checks, authenticated review and explicit consent, cross-account codes, hash-only storage, expiry/replay, concurrent/conflicting claims, rollback on binding failure, credential changes, rotation/caps, approved commands/uploads/callbacks, website sends, post-render revocation and held legacy work.

Application/test TypeScript, local Prisma schema validation/Client generation, runtime JS syntax and tracked-file whitespace checks passed. An initial TypeScript closure-narrowing issue was fixed by capturing the validated bot username before entering its transaction. No full suite, production build, visual rendering run, migration, deployment or live test was performed. Rendering code/assets were not edited.

Changed files: [schema](../prisma/schema.prisma), [SQL](../prisma/match-pairing.sql), [pairing helper](../scripts/lib/match-pairing.mjs), [helper types](../scripts/lib/match-pairing.d.mts), [bot](../scripts/bot.mjs), [worker](../scripts/lib/worker-core.mjs), [Match page](../src/app/dashboard/match/page.tsx), [actions](../src/app/dashboard/match/pairing-actions.ts), [form](../src/app/dashboard/match/pairing-form.tsx), [fake database](../tests/helpers/fake-prisma.ts), [worker tests](../tests/worker-core.test.ts), [pairing tests](../tests/match-pairing.test.ts), [action tests](../tests/match-pairing-actions.test.ts), [migration tests](../tests/match-pairing-migration.test.ts), [dashboard tests](../tests/match-dashboard.test.ts), and this report. Existing poller tests were run unchanged. Ignored storage contains only local schema-tooling artifacts; generated Client files are ignored dependencies.

**Stop point:** implementation prepared for independent review. No migration, live activation, service restart, environment change or production data operation is authorized by this preparation.
