# Renderer operational improvements ? prepared, not activated

Date: 2026-11-06. Scope: the existing main-project renderer only. The ZIP implementation was not installed or substituted.

## Implemented

- **In-flight logo deduplication:** [operations.js](../render/operations.js) shares only overlapping work for the same canonical URL/cache key. The map has a hard 16-entry cap, no result/history cache and no extra waiting queue; entries disappear on success/failure. Existing pinned downloads, limits, safe fallback and per-request image/manifest validation are unchanged. The HTTP regression proves two overlapping equivalent URL requests cause one download; a later failed-cache miss retries normally.
- **Request diagnostics:** server-generated UUID X-Request-ID headers and one completion log with route/status/elapsed time. No client-provided request IDs, image/text payloads, URLs or secrets are retained in metrics. Authenticated GET /render-health uses the existing renderer secret and returns fixed Match/News buckets, success/failure/rejection/cancellation counts, admitted in-flight requests, drain state and p50/p95 latency over at most the last 200 successful HTTP requests per route. Latency includes body/queue/render/response completion, not only Chromium capture. Existing /news-health protocol-2 JSON and render response bodies remain unchanged. No new environment settings.
- **Page deadlines and draining:** a single cleared timer bounds each Match attempt, News browser phase and warm-up page to 300 seconds. Only the timed-out page is closed; the shared browser/context is not reset. Existing shorter navigation/capture limits and Match retry policy remain. The deadline excludes image preprocessing, native Sharp/export and filesystem work; it is not an end-to-end native-code cancellation guarantee. On SIGINT/SIGTERM or the existing private disposable-child IPC shutdown, stop new admissions/listening, finish admitted HTTP jobs (including queue waiters under existing queue timeout/error rules), await warm-up and response flushing, then close Chromium. Duplicate shutdown requests are idempotent. No forced shutdown deadline aborts active work. New admitted-work requests on an existing connection are rejected while draining. No public HTTP shutdown route was added.
- **Resilient fast capture:** one qualifying CDP failure falls back for that request without disabling the fast path globally. Three consecutive qualifying failures disable fast capture; a successful fast capture resets the streak. Closed pages, browser disconnect/crash, timeout and page-deadline errors do not count as capability failures. Both Match and News retain their shared capture policy, persistent browser and existing JPEG encoder/options.

## Skipped

Template-content caching: four small built-in template files have no demonstrated content-read bottleneck. Another cache/invalidation layer was not justified. Existing image metadata and custom-page font caches remain. No browser-generation manager, automatic recycling, automatic deletion, enlarged job queue, dependency, database/schema, auth/account-linking or deployment/configuration changes were introduced.

## Files changed

- Runtime: [render-server.js](../render/render-server.js), [news-renderer.js](../render/news-renderer.js), new [operations.js](../render/operations.js).
- Regression tests: [render-server.test.ts](../tests/render-server.test.ts), [fake-playwright.cjs](../tests/helpers/fake-playwright.cjs), new [render-operations.test.ts](../tests/render-operations.test.ts) and [render-lifecycle.test.ts](../tests/render-lifecycle.test.ts).
- This report. Ignored before/after snapshots, deterministic comparison driver and generated test JPGs are test evidence, not deployment files.

## Verification

- **60 unique focused tests passed across five files:** render-operations 11, render-server 30, render-lifecycle 2, final-document 11, news-renderer 6. The helper file alone was rerun after adding the final explicit cache-cap assertion (11 passed); this is not another 11 unique tests. No test failures occurred in these focused runs.
- Coverage includes concurrent canonical-URL deduplication and retry after failure, bounded independent metrics/percentiles, timer cleanup and page-only expiry, capture failure/reset/exclusion policy, genuine HTTP capture fallback behavior, and repeated graceful shutdown with four admitted active/queued Match and News requests.
- Existing HTTP R1?R4 regressions still pass: protected URL localization, image/SVG/APNG rejection, final post-expansion resource validation, distinct same-ID output paths and concurrent News survival during Match failures. The final-document regressions pass. Real isolated News integration passes all four layouts and the unchanged authentication/protocol checks.
- Application and test TypeScript checks passed with incremental output disabled; edited runtime/fake-browser JavaScript syntax checks passed. No production build or unrelated full suite ran.
- **All eight actual before/after JPG pairs are byte-identical**, zero differing pixels, 1080x1350 JPEG: Match classic/panel/frame/stripe and News single/left/right/breaking. Identical inputs used the same warmed, test-owned Chromium/Match context and deterministic grain fixture. [Results](../storage/renderer-operations/visual-results.json), [before/after JPGs](../storage/renderer-operations/visuals/) and the comparison driver remain in ignored storage. Final runtime files match the compared after snapshot. This proves these fixtures, not every possible upload/environment or custom design.
- Byte comparison confirmed [security.js](../render/security.js), [template-check.js](../render/template-check.js), [final-document.js](../render/final-document.js) and [custom-resources.js](../render/custom-resources.js) are unchanged from the captured before snapshot. R2 parsing, final expansion ordering, immutable manifests, CSP/request guards, pinned DNS/SSRF policy and image limits were not weakened.

## Operational limits and activation

No live renderer, website, bot or worker was stopped/restarted. No production database or credentials were accessed or changed, no environment/deployment configuration changed and no dependencies were installed. Tests used private disposable children, dummy renderer keys and mocked or isolated rendering only. No live Telegram or Google login test is claimed. H1/H2 are unchanged and separately gated.

A supervisor/operator must allow graceful draining; Windows forced termination, SIGKILL and machine failure cannot execute drain handlers. Draining can wait for existing work, and native-code stalls outside the browser phase are not forcibly cancelled. Existing vector/CSS complexity and genuine shared-browser crash risks remain. No fresh before/after latency benchmark was performed; the measured optimization assertion is reduced duplicate download calls, not a claimed millisecond speedup.

Changes require a separately approved service restart to become active. Before that approval, refresh release/rollback file fingerprints to include this operational module and News integration; do not deploy unrelated prepared H1/H2 work or use a stale activation manifest. No activation was performed.
