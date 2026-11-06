# Release preparation checklist

Updated 2026-11-06. NOT READY for activation: preparation is complete, but the approval/deployment gates below remain. Documentation-only inspection; no production connectivity, services, tests or builds were run. [Activation and rollback runbook](./STAGE1_ACTIVATION.md) is authoritative for order and safety.

## Actual outstanding gates

- [ ] Freeze/review a complete release artifact: required files below are currently untracked, and tracked changes also need inclusion. Do not ship only git-tracked content. This task does not stage, commit or push.
- [ ] Separately approve H1/H2 database execution after target/schema/checksum verification and a verified recoverable backup; neither prepared migration is treated as executed.
- [ ] Approve and operationalize supervised legacy Google recovery, disputed-password decisions, session revocation and user communication; legacy Match accounts require explicit website-authorized reconfirmation. No automatic migration by email/chat ID is permitted.
- [ ] Establish a complete security-safe rollback artifact and host-specific stop/start/switch commands. An insecure pre-H1/H2 release is not a usable active fallback.
- [ ] Complete final frozen-release build/platform verification and approved manual OAuth/Telegram/JPG smoke tests on the deployment target. Existing focused test history does not establish a tested combined ARM deployment. No additional code defect is asserted by these pending operational gates.

## Neon PostgreSQL deployment checklist

- [ ] Independently confirm intended project, production branch, database and public schema using non-sensitive metadata under later approval. Stop on drift or unexpected existing tables. Do not infer target from an old report.
- [ ] Verify recoverable backup/restore point, retention window, access and recovery procedure before migration; backup branches are not implicitly authorized.
- [ ] Compare the two exact standalone SQL hashes in the activation runbook; use approved limited DDL permissions, stop-on-error execution and each file's transaction/timeouts. Record results without private rows. Do not run other migrations or startup installers.
- [ ] Verify the new unique/FK/check constraints and preserved existing records. Keep the already completed four-column News upgrade; do not replay it by default.
- [ ] Generate matching Prisma Client in staged build; verify application-role table permissions. Keep ordinary database queries and direct session-lock connections compatible with existing Neon configuration. Confirm outbound TLS/direct connectivity; never print connection strings.
- [ ] Later preflight must detect any existing conflicting bot registrations before starting consumers; fail closed and resolve ownership explicitly if encountered. This document does not claim such conflicts currently exist.

## Oracle Cloud Always Free ARM checklist

- [ ] Confirm the actual ARM64 VM, OS support, available capacity, free-tier eligibility/quotas and storage/RAM budget in the chosen region. Provisioning and billing checks are not performed here. Do not assume a Chromium workload fits merely because the VM is free-tier eligible.
- [ ] Build/install from the frozen lockfile on compatible Linux ARM64 staging with the project's Node 24 runtime, matching Prisma generation, Sharp native binaries, Playwright Chromium and OS libraries. Never copy Windows node_modules, generated native engines or .next into ARM production. Verify current Playwright OS/ARM support before choosing the image.
- [ ] Use one persistent shared Chromium renderer and initially one website process; configure bounded supervisor restart/drain behavior, non-root ownership and persistent storage. Do not use the development startup batch file as the Linux production supervisor.
- [ ] Map uploads, posts, cursors and backgrounds consistently into every release working directory, without automatic deletion. Before moving existing Windows data, verify stored file references are portable; any required path/data translation needs its own approved plan. Do not silently rewrite production paths.
- [ ] Bind website/renderer to loopback behind an HTTPS reverse proxy; expose only intended public endpoints. Keep renderer authentication/secret agreement and CSP/manifest restrictions intact. Restrict public network access to internal renderer ports.
- [ ] Use protected host secret configuration, not copied repository .env files. Verify required variables by presence only, production site/callback URLs, cookie HTTPS behavior and Google console redirect allowlisting through an approved deployment procedure. This task changes none of them.
- [ ] Define exact service units/working directories and dependencies for renderer, website, Match manager, worker and News manager. Check all other hosts/supervisors and Telegram webhook ownership before enabling polling. Never automatically delete a webhook.
- [ ] Run the approved release smoke checks and observe memory, render health and delivery results before reopening full traffic. Preserve JPG settings: 1080x1350; updated built-in BREAKING is intentional, other templates must retain approved output.

Suggested production entry points (record host paths and supervisor environment separately): renderer = node render/render-server.js; website = node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000; Match = node scripts/bot.mjs; worker = node scripts/worker.mjs; News = node scripts/news-bot.mjs. These are reference commands, not an instruction to run them now. Supply existing approved environment through the supervisor; never log it.

## Required untracked files

Inventory from actual git status on 2026-11-06. Include these in release/version history as appropriate: runtime/assets in the deployable artifact, tests/docs/SQL in the reviewed release source bundle. Include every tracked modification required by the same frozen release as well; this is not a complete manifest of tracked files. Font licenses accompany their font binaries. The nested News package.json is a runtime module-format declaration.

### Runtime modules and type declarations (36)

- [render/custom-resources.js](../render/custom-resources.js)
- [render/final-document.d.ts](../render/final-document.d.ts)
- [render/final-document.js](../render/final-document.js)
- [render/news-renderer.js](../render/news-renderer.js)
- [render/operations.js](../render/operations.js)
- [render/security.d.ts](../render/security.d.ts)
- [render/security.js](../render/security.js)
- [scripts/lib/background-files.mjs](../scripts/lib/background-files.mjs)
- [scripts/lib/idle-cache.mjs](../scripts/lib/idle-cache.mjs)
- [scripts/lib/match-pairing.d.mts](../scripts/lib/match-pairing.d.mts)
- [scripts/lib/match-pairing.mjs](../scripts/lib/match-pairing.mjs)
- [scripts/lib/news-core.mjs](../scripts/lib/news-core.mjs)
- [scripts/lib/news-manager-lock.mjs](../scripts/lib/news-manager-lock.mjs)
- [scripts/lib/news-preflight.mjs](../scripts/lib/news-preflight.mjs)
- [scripts/lib/process-lock.mjs](../scripts/lib/process-lock.mjs)
- [scripts/lib/update-cursor.mjs](../scripts/lib/update-cursor.mjs)
- [scripts/news-bot.mjs](../scripts/news-bot.mjs)
- [src/app/api/news/preview/route.ts](../src/app/api/news/preview/route.ts)
- [src/app/back-to-dashboard.tsx](../src/app/back-to-dashboard.tsx)
- [src/app/dashboard/match/page.tsx](../src/app/dashboard/match/page.tsx)
- [src/app/dashboard/match/pairing-actions.ts](../src/app/dashboard/match/pairing-actions.ts)
- [src/app/dashboard/match/pairing-form.tsx](../src/app/dashboard/match/pairing-form.tsx)
- [src/app/news/actions.ts](../src/app/news/actions.ts)
- [src/app/news/bot-link.tsx](../src/app/news/bot-link.tsx)
- [src/app/news/page.tsx](../src/app/news/page.tsx)
- [src/app/news/template-editor.tsx](../src/app/news/template-editor.tsx)
- [src/lib/admission.ts](../src/lib/admission.ts)
- [src/lib/google-auth.ts](../src/lib/google-auth.ts)
- [src/lib/news/conversation.ts](../src/lib/news/conversation.ts)
- [src/lib/news/fields.ts](../src/lib/news/fields.ts)
- [src/lib/news/html.ts](../src/lib/news/html.ts)
- [src/lib/news/package.json](../src/lib/news/package.json)
- [src/lib/news/parse.ts](../src/lib/news/parse.ts)
- [src/lib/news/preview.ts](../src/lib/news/preview.ts)
- [src/lib/news/render.ts](../src/lib/news/render.ts)
- [src/lib/resource-transactions.ts](../src/lib/resource-transactions.ts)

### Assets and license files (10)

- [public/news-previews/breaking.jpg](../public/news-previews/breaking.jpg)
- [public/news-previews/left.jpg](../public/news-previews/left.jpg)
- [public/news-previews/right.jpg](../public/news-previews/right.jpg)
- [public/news-previews/single.jpg](../public/news-previews/single.jpg)
- [render/fonts/anton-OFL.txt](../render/fonts/anton-OFL.txt)
- [render/fonts/anton.ttf](../render/fonts/anton.ttf)
- [render/fonts/leaguegothic-OFL.txt](../render/fonts/leaguegothic-OFL.txt)
- [render/fonts/leaguegothic.ttf](../render/fonts/leaguegothic.ttf)
- [render/fonts/montserrat-OFL.txt](../render/fonts/montserrat-OFL.txt)
- [render/fonts/montserrat.ttf](../render/fonts/montserrat.ttf)

### Database SQL (3)

- [prisma/auth-identity.sql](../prisma/auth-identity.sql)
- [prisma/match-pairing.sql](../prisma/match-pairing.sql)
- [prisma/news-four-columns.sql](../prisma/news-four-columns.sql)

### Focused regression tests (25)

- [tests/auth-identity-migration.test.ts](../tests/auth-identity-migration.test.ts)
- [tests/background-files.test.ts](../tests/background-files.test.ts)
- [tests/final-document.test.ts](../tests/final-document.test.ts)
- [tests/google-auth.test.ts](../tests/google-auth.test.ts)
- [tests/google-callback.test.ts](../tests/google-callback.test.ts)
- [tests/helpers/image-fixtures.ts](../tests/helpers/image-fixtures.ts)
- [tests/match-dashboard.test.ts](../tests/match-dashboard.test.ts)
- [tests/match-pairing-actions.test.ts](../tests/match-pairing-actions.test.ts)
- [tests/match-pairing-migration.test.ts](../tests/match-pairing-migration.test.ts)
- [tests/match-pairing.test.ts](../tests/match-pairing.test.ts)
- [tests/news-breaking.test.ts](../tests/news-breaking.test.ts)
- [tests/news-renderer.test.ts](../tests/news-renderer.test.ts)
- [tests/news.test.ts](../tests/news.test.ts)
- [tests/password-login.test.ts](../tests/password-login.test.ts)
- [tests/process-lock.test.ts](../tests/process-lock.test.ts)
- [tests/render-images.test.ts](../tests/render-images.test.ts)
- [tests/render-lifecycle.test.ts](../tests/render-lifecycle.test.ts)
- [tests/render-operations.test.ts](../tests/render-operations.test.ts)
- [tests/render-security.test.ts](../tests/render-security.test.ts)
- [tests/resource-controls.test.ts](../tests/resource-controls.test.ts)
- [tests/signup-resources.test.ts](../tests/signup-resources.test.ts)
- [tests/telegram-resources.test.ts](../tests/telegram-resources.test.ts)
- [tests/template-boundaries.test.ts](../tests/template-boundaries.test.ts)
- [tests/ui-review.test.ts](../tests/ui-review.test.ts)
- [tests/update-cursor.test.ts](../tests/update-cursor.test.ts)

### Release and security documentation (8)

- [docs/H1_AUTH_PREPARATION.md](../docs/H1_AUTH_PREPARATION.md)
- [docs/H2_MATCH_PAIRING.md](../docs/H2_MATCH_PAIRING.md)
- [docs/PRODUCTION_AUDIT.md](../docs/PRODUCTION_AUDIT.md)
- [docs/RENDERER_FIXES.md](../docs/RENDERER_FIXES.md)
- [docs/RENDERER_OPERATIONS.md](../docs/RENDERER_OPERATIONS.md)
- [docs/RENDERER_SECURITY_REVIEW.md](../docs/RENDERER_SECURITY_REVIEW.md)
- [docs/STAGE1_ACTIVATION.md](../docs/STAGE1_ACTIVATION.md)
- [docs/STAGE1_HARDENING.md](../docs/STAGE1_HARDENING.md)

### This new release checklist

- [docs/RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) (created by this documentation task; include with the release).

## Deliberately excluded historical/local files

- [render/render-server.backup.js](../render/render-server.backup.js): retained historical implementation, not the renderer entry point or a security-safe rollback artifact.
- [INSTALL_NEWS.cmd](../INSTALL_NEWS.cmd) and [NEWS_INSTALL_README.txt](../NEWS_INSTALL_README.txt): retained installation history, not the controlled production migration/startup procedure. Do not execute them for this release.
- Do not package actual .env/credentials, local databases, user storage/logs, reference ZIPs, sample outputs, caches, node_modules or .next from Windows. Persistent user data is preserved and backed up separately, not deleted.
- Preserve the existing staged removal of tsconfig.tsbuildinfo from Git tracking and the local ignored file. Preserve the reviewed deletion of unused dashboard auto-refresh source. No staging or cleanup is performed by this task.

## Current verification boundary

Only Git inventory, existing plans, migration hashes and deployment metadata were read for this update. Prior tests/reviews are documented in their individual reports; they were not repeated. Oracle provisioning, live Neon schema/backup, account recovery, final host build and external OAuth/Telegram behavior remain unverified here. These are release gates, not claims of a new application vulnerability.
