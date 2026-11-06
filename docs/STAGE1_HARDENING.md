# Stage 1 security and lifecycle hardening

Date: 2026-11-05. Main project only. Implemented in source; **not activated in existing live processes**. Stage 2 and Stage 3 remain unapproved and untouched.

## Changes

- Dedicated, distinct PostgreSQL session locks for Match manager, Match worker and News manager; retain the original News lock ID. Background heartbeats verify both backend identity and actual advisory-lock ownership. Connection/ownership loss stops work and never automatically reacquires a lock.
- Match polling checks existing webhooks without deleting them. A webhook or Telegram 409 blocks that poller until an operator resolves the conflict and restarts it. A second updated manager/worker exits without starting work.
- Match update cursors are atomically checkpointed in hashed files under storage/bot-cursors before dispatch, preventing ordinary replay across restarts. Week-old cursors expire to accommodate Telegram update-ID reseeding. Corrupt/unwritable cursor storage fails closed.
- Worker recovery now considers only SENDING rows stale for 15 minutes, including at startup; excludes current claims and locally known delivered-but-unsaved jobs. Lock loss prevents a completed render from being sent or reset for retry.
- Match render endpoint now requires the existing NEWS_RENDER_SECRET, also supplied by its dashboard/worker callers. No new secret or configuration change. Safe text escaping, a strict compatible event/SVG allowlist, bounded JSON/image downloads, physically confined local image paths, and CSP defend the HTML boundary.
- Public-image downloader validates every DNS answer and redirect, pins approved socket addresses, rejects private/reserved destinations and credentials, and enforces byte/time limits. Cached images retain the original bytes. Browser requests cannot fall back to arbitrary remote logos. Only the selected, validated local background is inspected for metadata.
- Renderer accepts two active jobs and four queued jobs, with a 15-second queue limit and HTTP 429 backpressure. The existing worker treats 429 as transient. HTTP bodies are limited to 45 MiB. Built-in templates keep native Chromium caching; customer templates retain request interception and a small trusted-font cache.

## News lock loss

The configured Neon hostname uses transaction pooling. Session advisory locks are unsupported through that pooler; see [Neon pooling limitations](https://neon.com/docs/connect/connection-pooling). Dedicated lock sessions now derive the equivalent direct Neon hostname, keeping the existing database, authentication and connection options. Prisma remains on the unchanged pooled configuration. No environment file was edited.

A production **read-only transaction** successfully verified the direct connection and session-lock catalog visibility. It neither acquired manager locks nor changed records. The old logs establish polling failures followed by lock loss, but do not distinguish the exact original network/database failure. Sanitized reason/SQLSTATE/network-code diagnostics now distinguish future failures without exposing connection details. No protection was weakened.

## Validation

| Check | Result |
| --- | --- |
| Complete automated suite | 266 tests across 20 files passed. |
| Final background-path edge case and affected suites | 80 tests across 3 files passed, including one additional regression after the complete suite. |
| Application TypeScript | Passed, incremental output disabled. |
| Test TypeScript | Passed; rechecked after the additional regression. |
| Prisma generation | Passed into an isolated generated-client directory, using a dummy datasource. No migration or database write. |
| Production build | Passed in the secret-free after snapshot; live .next untouched. Google OAuth/callback, Match and News routes compiled. |
| Lint | No lint script is configured; no dependency/tooling changes introduced. |
| Visual regression | Classic, Panel, Frame, Stripe and News single/left/right/breaking: 1080 x 1350 JPG, byte-identical before/after pairs, zero differing pixels. |
| Preservation | 85 existing runtime/source/asset/config files matched the frozen baseline, including Google routes, News conversation/template code, fonts, all built-in Match templates, Prisma schema, package manifests and Next configuration. |
| Live state | Original website, renderer, Match bot and worker PIDs remained running with unchanged start times. No service stopped/restarted and no new production bot started. |

The isolated build warned about nested lockfiles/root inference; this is a validation-copy artifact, not a compilation failure. PowerShell initially blocked npm.ps1/npx.ps1; checks used the normal npm.cmd/npx.cmd launchers without changing execution policy. PostgreSQL emitted its existing warning about future sslmode semantics; no TLS option or dependency version was changed.

Live Google sign-in, Telegram delivery, duplicate-manager operation against production and fault injection into live Neon were deliberately not performed. Singleton/failure behavior is covered with deterministic mocks. New security/lifecycle behavior is not active until coordinated deployment.

## Rendering performance and output

Persistent warmed Chromium, identical inputs, alternating before/after handlers in the same Node process, eight measured requests per variant, same warmed Match context and identical captured grain fixture. Authentication and the full HTTP-to-JPG path are included. No real credentials in snapshots.

| Generator | Before mean | After mean | Difference |
| --- | ---: | ---: | ---: |
| Match | 2,111 ms | 2,170 ms | +59 ms (+2.8%) |
| News | 1,847 ms | 1,793 ms | -54 ms (-2.9%) |

No material average regression was observed in this small local sample. Timings varied: Match medians were 1,732 / 2,301 ms; News medians 1,879 / 1,801 ms. These are local measurements, not a latency guarantee or statistically established speedup. Earlier isolated-process runs were sensitive to scheduling/font-cache state, so those are retained for inspection but not used to claim improvement. Per-render URL interception and Node font fetching were avoided for built-ins after measuring their overhead. Persistent browser reuse, dimensions, JPEG quality, layouts and fonts remain unchanged.

[Raw controlled benchmark](../storage/stage1-hardening/coupled-benchmark.json) ? [Pixel results](../storage/stage1-hardening/visual-results.json) ? [Comparison JPGs](../storage/stage1-hardening/controlled-visual/) ? [Preservation details](../storage/stage1-hardening/preservation-results.json)

## Files changed by this stage

Existing runtime files:

- [Match manager](../scripts/bot.mjs), [poller](../scripts/lib/poller.mjs), [worker entry](../scripts/worker.mjs), [worker core](../scripts/lib/worker-core.mjs).
- [News manager](../scripts/news-bot.mjs), [News lock adapter](../scripts/lib/news-manager-lock.mjs).
- [Renderer](../render/render-server.js), [worker renderer client](../scripts/lib/render.mjs), [website renderer client](../src/lib/render.ts).

New runtime files:

- [Process locks](../scripts/lib/process-lock.mjs), [update cursors](../scripts/lib/update-cursor.mjs), [renderer security](../render/security.js), [security declarations](../render/security.d.ts).

Regression coverage:

- [Process locks](../tests/process-lock.test.ts), [cursor persistence](../tests/update-cursor.test.ts), [renderer security](../tests/render-security.test.ts).
- [Poller](../tests/poller.test.ts), [worker](../tests/worker-core.test.ts), [renderer HTTP](../tests/render-server.test.ts), [fake browser](../tests/helpers/fake-playwright.cjs), [runtime module declarations](../tests/mjs.d.ts).

Documentation: this report and an appended status in [the original audit](./PRODUCTION_AUDIT.md). Ignored validation copies/results remain under storage/stage1-hardening. No user file deletion/move, dependency change, schema change, credential change or old-workspace edit.

## Activation and remaining risks

**A coordinated rebuild/restart is required and has not been performed.** After approval, stop the existing Match manager/worker before launching updated versions: legacy running versions do not participate in the new locks. Rebuild the main website and restart renderer/website/Match manager/worker together so both clients and renderer use the existing authentication key. Check webhook/duplicate-process state before restarting News; never clear an existing webhook automatically. Verify renderer health and perform manual Google, Match and all-four-News Telegram tests after activation.

The two approval-gated identity findings (Google/password account ownership and initial Match chat linking) remain High and require Stage 2 decisions. Existing retention/shared-file-reference risks are unchanged. No schema-free design can guarantee exactly-once Telegram delivery across a crash after Telegram accepted a document but before its completion was durably recorded; stale recovery retains that uncertainty. Checkpoint-before-dispatch prevents replay but can lose an in-flight update on a crash; the user may need to resend it. Locks require direct Neon connectivity, and cursor storage must be persistent/writable. The successful read-only connection check is not a full outage test. Continue using loopback-only renderer exposure and protect the existing shared secret.
