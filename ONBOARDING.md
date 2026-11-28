# Final Whistle onboarding

Read [PROJECT_STATUS.md](PROJECT_STATUS.md) first for the current verification and activation state. This checkout contains important uncommitted work: preserve it; never reset/clean it to GitHub. Work only in this repository, not the separate News Post Studio project.

## Purpose and architecture

Local Windows football graphics application, using Next.js 16, TypeScript/Node.js, Prisma and Neon PostgreSQL. A shared Chromium/Sharp renderer produces 2160×2700 lossless PNGs. Telegram uses the existing bots through outbound **Bot API polling**, not personal Telegram sessions.

| Location | Responsibility |
| --- | --- |
| [src/app](src/app) | Website, authentication, dashboard, owner-only User Management, HTTP routes and server actions |
| [src/features/match](src/features/match) | Match dashboard and editor feature modules |
| [src/lib/news](src/lib/news) | News parsing, layouts, standings and renderer client |
| [scripts/lib](scripts/lib) | Bot authorization, scheduling, worker logic, provider integration and maintenance |
| [render](render) | Authenticated loopback renderer, Chromium containment, Sharp and existing templates/assets |
| [prisma/schema.prisma](prisma/schema.prisma) | Database models; approved additive SQL migrations live alongside it |
| [tests](tests) | Mocked unit/integration tests; some separate renderer tests require Chromium |
| [storage](storage) | Private runtime uploads, cursors, backups and temporary files; excluded from Git |

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the detailed module map.

## Execution flows

### Pending local Match coverage expansion (not activated)

Local source now includes Europa League ID 3 and exact senior-team IDs Argentina 26, Brazil 6 and Inter Miami 9568. These nine team/competition IDs were verified against API-Football metadata in the approved read-only check. National-team fixtures include international friendlies. Miami inclusion is restricted to the verified competition IDs MLS 253, Leagues Cup 772, CONCACAF Champions League 16, US Open Cup 257 and FIFA Club World Cup 15; unknown competitions are excluded until their official metadata is verified.

The shared date response is still filtered locally. New cache keys append `|coverage-v1`; each required date is downloaded once under that policy, with concurrent callers sharing the request. No existing records are cleared. Cold Tbilisi discovery now loads the two intersecting UTC dates (plus an earlier date only if the existing four-hour carryover requires it). Warm caches avoid downloads. A deterministic year-boundary 02:30 cold-cache failure was reproduced before this change; already-cached midnight fixtures retain the existing behavior.

Existing Telegram commands, 50-button limit/search, private user isolation, worker timings (107-minute gate, one-minute configured checks, 24-hour processing window), cards, templates, PNG settings and delivery remain unchanged. Dashboard league filters include Europa; a matching-style favorite-team group supports the three exact IDs before any Team metadata has been downloaded. No database migration or seeding command is required. The UEL text-label helper remains available, while the Europa League match marker displays a trophy-only symbol.

Focused tests and TypeScript checks for this local revision pass. Before activating it, manually build and verify the production guard and sensitive traces. The currently running production system was not restarted; do not assume previous production checks cover this source revision. No shootout-score presentation was added. Full test results and API costs are recorded in [PROJECT_STATUS.md](PROJECT_STATUS.md).

Competition symbols and text fallbacks use the Match marker helper. MLS shield appears only for league ID 253 when team ID 9568 participates. The globe appears only for international friendly ID 10 with Argentina or Brazil. Other new-team competitions use exact-ID abbreviations. The renderer uses safe local SVG assets with optical dimensions and aspect-ratio containment. Match competition lines reuse their left-side color stops with the opposite CSS gradient direction; the News standings accent helper is unchanged.

- **Match:** [bot.mjs](scripts/bot.mjs) authenticates a private Telegram sender, loads that user's selections/settings, and queues ordered commands. [worker.mjs](scripts/worker.mjs) independently monitors fixtures and uses [worker-core.mjs](scripts/lib/worker-core.mjs) for the existing LIVE 90+ and final-delivery rules. Rendering goes through the shared renderer, and Telegram receives a PNG document. Selection dispatch fences and compact delivery receipts prevent unsafe automatic resends.
- **News:** [news-bot.mjs](scripts/news-bot.mjs) routes owner/delegated users to isolated persisted NewsSettings conversations. [news-core.mjs](scripts/lib/news-core.mjs) preserves existing photo/options/version/text/branding flows, including Large Headline Automatic and Manual. Standings reuse the existing provider and layout pipeline. Render/send markers retain uncertain deliveries.
- **Polling:** separate accepted and persisted-completed offsets allow re-fetching without acknowledging unfinished work. Already accepted updates are skipped in memory. Each bot keeps one poller; per-conversation queues preserve ordering and owner capacity. Telegram retention and replay limitations are in [SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md).

## Access and database

Owner website accounts administer numeric Telegram User IDs through `/dashboard/users`, with separate Match/News permissions and status/version revocation. Delegates receive separate internal principals without website login credentials. Authorization is checked at operation and delivery boundaries. Scoped database access prevents cross-user private reads/writes; it is **application enforcement, not PostgreSQL RLS**.

There are 18 application tables:

- Identity/access: User, AuthIdentity, Session, TelegramMember, MatchPairingChallenge, MatchTelegramBinding.
- Personal configuration: Brand, Subscription, FavoriteTeam, Template, NewsTemplate, NewsSettings.
- Shared football/cache data: Match, Team, FixtureDay, ApiUsage.
- Per-user delivery: Selection, MatchDeliveryReceipt.

The approved TelegramMember and MatchDeliveryReceipt additive migrations are installed. On 2026-11-28 the approved `final_whistle_runtime` login was activated for all 18 tables. Runtime `.env` uses this restricted role; the preserved administrative login is in the separately loaded, ACL-protected `.env.migration`. Never copy migration credentials into Next auto-loaded environment variants. Each future table migration needs explicit runtime grants.

## Security and storage

Preserve loopback binding, nonce CSP, restricted registration, password hashing, OAuth state/PKCE/subject binding, secret redaction, permission/version checks, bounded owner-priority queues, upload bounds, TLS verification, Chromium sandboxing, SSRF and file containment. Restrictive delegated quotas remain disabled; emergency disk checks remain enabled.

[STORAGE_MAINTENANCE.md](docs/STORAGE_MAINTENANCE.md) defines the approved apply-mode policy: confirmed-delivery artifacts, 24-hour abandoned temporaries, expired auth records, safe 48-hour Match archival and 30-day settled receipts. Never age-delete uncertain deliveries or permanent user data. Housekeeping runs inside existing processes; no new service was added.

## Commands and restrictions

Latest owner confirmation (2026-11-28): manual production build and build guard passed (local build `WHJAwDvyB2PIPsT5tJdBu`); sensitive-trace verification returned `{"manifests":18,"blockedFiles":0,"categories":{}}`. The owner manually started production and confirmed everything works correctly. The encrypted recovery materials are copied to external USB storage. Do not repeat these successful checks or restart running services just for publication. A full PostgreSQL restore and recovery on another computer were not tested.

Development: `npm run dev` (loopback website only). Other existing entries are `npm run render`, `npm run bot`, `npm run worker`, and `npm run news:bot`. Do not run duplicate pollers or automatically start these without the owner's request.

For future source/configuration changes, before manual production startup run sequentially (the current final checks already passed):

```powershell
npm run build
node scripts/production-build-guard.mjs verify
node scripts/verify-sensitive-traces.mjs
```

Each command must succeed before proceeding. Use [start-system-production.bat](start-system-production.bat) manually afterward. Environment/source changes invalidate the build fingerprint. Do not call the guard's `finish` command manually to bless a failed build. The old [start-system.bat](start-system.bat) uses development mode.

Official 7-Zip 26.06 is installed. The owner confirmed successful AES-256 archive integrity, extraction of 50 files, all 49 manifest checksums, extracted ACL protection and in-memory EFS private-key verification. No certificate was installed, and no original backups or database records changed. Only the temporary verified extraction was subsequently removed with approval. A full PostgreSQL restore and recovery on another computer were **not tested**.

For future NEW backup copies only, use a normal interactive PowerShell terminal and enter archive/PFX passwords only into native prompts; do not recreate the existing verified archive:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/security/protect-backups.ps1 -ExportEfsCertificate
```

Preserve the resulting encrypted archive, a copy of [recover-backups.ps1](scripts/security/recover-backups.ps1), and official 7-Zip installation instructions off-device. Keep passwords separately. Test independent recovery into a NEW, non-EFS directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/security/recover-backups.ps1 -ArchivePath 'D:\Recovery\backups.7z' -Destination 'C:\Recovery\verified-new' -VerifyEfsCertificate
```

Paths above are examples: the parent recovery directory must already exist and the destination must not. The recovery script checks every archived checksum and can verify the PFX private key in memory without installing it. It does not restore a database. Use `-VerifyExtractedOnly` only with an existing protected extraction to resume checksum/PFX checks without repeating archive testing or extraction. The previous temporary extraction no longer exists.

### Exact external recovery set

Copy these files to secure external storage, keeping the scripts/instructions alongside the archive:

- [backups.7z](storage/recovery-exports/20261128-042850-8a2453bfb9634690a1b068afe110aca9/backups.7z): verified encrypted backup, including its checksum manifest.
- [efs-recovery.PFX](storage/recovery-exports/20261128-042850-8a2453bfb9634690a1b068afe110aca9/efs-recovery.PFX): password-protected EFS private-key recovery copy (also included inside the archive).
- [recover-backups.ps1](scripts/security/recover-backups.ps1): portable recovery tool, requiring official 7-Zip and a supported Windows/.NET installation.
- This [ONBOARDING.md](ONBOARDING.md) and [SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md): recovery, startup and rollback instructions. Preserve their relative `docs/` location if retaining clickable links.

Keep strong archive and PFX passwords separately, never in this external folder, source code, command arguments, environment variables or chat. Do not copy unencrypted extracted files or raw credential files into an unprotected external folder. The owner confirms copying the encrypted recovery materials to external USB storage; the agent did not perform that copy. Retain all local original backups, the original exported PFX and the encrypted archive. Official 7-Zip distribution: https://www.7-zip.org/download.html.

For approved migration tooling only, explicitly load `.env.migration`; normal launchers remain unchanged. Rollback requires manually stopping services, restoring the former `.env` from the protected pre-change backup, then rebuilding and verifying the guard/traces. Do not restore database data or remove the runtime role as routine rollback. See the current activation entry in [PROJECT_STATUS.md](PROJECT_STATUS.md).

Focused tests: `node node_modules/vitest/vitest.mjs run tests/<file>.test.ts --maxWorkers=1 --no-file-parallelism`. Type checks: `npm run typecheck`. On the 4 GB laptop, run heavy operations sequentially with appropriate free memory; reuse valid results.

No unapproved production DB changes, real Telegram test messages, account/service creation, commits, pushes, deployments, or deletion of existing user data/backups. Preserve layouts, image resolution/quality, bot identities and automatic match timing. See [SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md) for explicit database activation, rollback and backup recovery steps.
