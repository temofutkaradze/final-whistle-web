# Final Whistle architecture

## Scope and organization

### Pending Match fixture coverage extension

[match-coverage.mjs](../scripts/lib/match-coverage.mjs) owns the exact-ID additional-team predicate, reference official Inter Miami competition allowlist and discovery policy version. [config.mjs](../scripts/lib/config.mjs) retains the existing league configuration plus Europa; [leagues.ts](../src/lib/leagues.ts) exposes dashboard league labels and the shared featured-team list. Team IDs and league IDs must never be conflated. Unknown Miami competitions fail closed until their metadata is verified; configured existing competition rules remain authoritative.

The [date loader](../scripts/lib/football.mjs) still fetches a broad UTC-date response, filters it locally, upserts each fixture once and records a policy-aware FixtureDay marker. The [list helper](../scripts/lib/match-list.mjs) ensures only the UTC dates required by the existing local-day/four-hour visibility window. Cache and in-flight reuse remain shared across users; no per-user/team polling was added. The existing worker parser recognizes `|coverage-v1` so existing FixtureDay retention also covers new keys.

Featured favorites can be saved by exact supported IDs without inserting synthetic Team records because FavoriteTeam has no Team foreign key. Existing owner/session scoping and private Telegram access remain unchanged. New fixtures enter the existing worker, event and rendering pipeline. [match-presentation.js](../render/match-presentation.js) maps exact competition/team identities to local symbols or concise labels, while the Match-only [match-accents.js](../render/match-accents.js) mirrors each marker's left gradient with the opposite CSS direction. The shared [league-accents.js](../render/league-accents.js) remains unchanged for News standings. Local symbols live under [render/assets/leagues/symbols](../render/assets/leagues/symbols) and pass the existing SVG validator. No migration, renderer fork or News change is involved. See [current status](../PROJECT_STATUS.md) for verification limits and API request costs.

Final Whistle has four separately launched Node processes in addition to the
Next.js website: the renderer, Match bot manager, Match worker, and News bot
manager. They are not Next.js background tasks. Keep their public entry points,
startup commands, process locks, and environment-loading behavior intact.

This organization separates responsibilities without changing contracts,
templates, database schema, dependencies, rendering settings, or launchers.
Existing uncommitted Large Headline work is part of the refactoring baseline.

```text
src/
  app/                         Next.js routes, layouts, route handlers, route UI
    dashboard/match/page.tsx    Match dashboard data loading and presentation
    dashboard/add-template.tsx Existing client editor entry point
    news/                      News dashboard, forms and server actions
    api/                       Health and authenticated News preview endpoints
    auth/                      OAuth redirect/callback endpoints
  features/match/
    dashboard/
      actions.ts               Authenticated dashboard server actions
      messages.ts              Existing dashboard status copy
    template-editor/
      types.ts                 Editing and save-action contracts
      definitions.ts           Editor choices, placeholders, example HTML
      fields.tsx               Client form controls and sandbox preview frame
  lib/
    match/template-builder/
      config.ts                Font catalog, allowed values, types, defaults, presets
      normalize.ts             Existing saved/browser configuration validation
    template-builder.ts        Compatible public exports and HTML composition
    news/                      News domain, conversation, templates, standings
    *.ts                       Shared web infrastructure and established facades
scripts/
  bot.mjs                      Match Telegram manager entry point
  worker.mjs                   Scheduled Match delivery entry point
  news-bot.mjs                 News Telegram manager entry point
  lib/
    football/time.mjs          Pure timezone and calendar calculations
    football.mjs               Existing API/cache entry point and time exports
    worker/retry.mjs           Error classification and per-instance backoff
    worker-core.mjs            Worker delivery/state orchestration and retry exports
    news-core.mjs              Durable News conversation and delivery orchestration
    *.mjs                      Telegram, persistence, locks, selection, integrations
render/
  render-server.js             HTTP composition root, admission, Match route, shutdown
  runtime/browser.js           Shared Chromium/context lifecycle factory
  runtime/image-export.js      Native capture, readiness, compatibility JPEG factory
  assets-runtime/logo-cache.js Validated logo localization/single-flight cache factory
  news/http-handler.js         Existing News HTTP protocol and request validation
  news-renderer.js             News composition and lossless image output
  *.js                        Shared document, security, layout and asset helpers
  templates/                  Built-in Match HTML templates
  fonts/, assets/             Existing runtime font and image assets
prisma/                       Schema and existing migration history
tests/                        Unit, mocked integration and real Chromium checks
```

## Runtime and framework boundaries

- `src/app` retains all framework-required route filenames and exports. Dashboard
  mutations live in `src/features/match/dashboard/actions.ts`, marked `use server`;
  authentication, queries, redirects, and function signatures are unchanged.
- The template editor and extracted interactive controls retain `use client`.
  Types use type-only imports. Builder configuration, normalization and HTML
  composition remain browser-compatible and do not import Node infrastructure.
- Server-only integrations (database, files, secrets, HTTP clients and Sharp)
  remain outside client imports. Do not import bot/worker entry points from the
  website: those files start polling or work on evaluation.
- Standalone scripts use native ESM `.mjs` and existing explicit `.ts` imports for
  the News domain. Renderer modules remain CommonJS. Preserve these formats.
- Database clients remain owned by their existing web and standalone adapters;
  no new clients, caches or connection pools are introduced by the extractions.

## Match execution flow

1. `scripts/bot.mjs` discovers account bots and processes Telegram updates through
   the existing polling, identity/pairing and selection helpers.
2. `scripts/lib/football.mjs` owns API-Football retrieval, request accounting and
   database cache updates. Its time exports delegate to `football/time.mjs`;
   configured timezone defaults and midnight/DST calculations are unchanged.
3. `scripts/worker.mjs` injects database, football, renderer, Telegram, clock and
   configuration dependencies into `worker-core.mjs`. The core retains its
   scheduling, live/final state machines, claims and delivery fences.
4. `scripts/lib/events.mjs` classifies and presents events. Card and goal logic is
   intentionally kept together with its per-call closures and reconciliation.
5. `scripts/lib/render.mjs` requests PNG-only output from `/render`. The dashboard
   uses `src/lib/render.ts` for sample images. Existing Telegram adapters send
   the resulting PNG as a document.

The retry module creates a fresh state map for each `createBackoff` call, exactly
as before. The old worker-core exports remain available to tests and consumers.
Do not merge this state with provider caches, process locks or delivery fences.

## News execution flow

1. `scripts/news-bot.mjs` owns its manager lock, owner contexts, Telegram polling,
   original image download/validation and the shared standings provider service.
2. `scripts/lib/news-core.mjs` authenticates updates, durably claims them, selects
   a conversation transition, resolves assets, renders, and sends a document.
3. `src/lib/news/conversation.ts` preserves the original Quotes workflow;
   `editorial.ts` handles editorial versions, Large Headline Automatic/Manual and
   Branding; `standings.ts` handles Tables, positions and branding navigation.
4. `src/lib/news/render.ts` authenticates and validates the local renderer
   protocol. The extracted `render/news/http-handler.js` retains its HTTP request
   limits, image decoding, job validation, error mapping and response format.
5. `render/news-renderer.js` uses the existing HTML builders and asset helpers.
   `html.ts`, `editorial-html.ts`, `breaking-html.ts` and `standings-html.ts` own
   their existing visual output. No template HTML or typography was refactored.

Standings retrieval uses the existing `football-data.ts` and adapters; this is a
different provider from the Match API-Football integration. Do not consolidate
the two integrations or their rate budgets merely because both contain football
data. Original image bytes, crop settings and lossless document delivery remain
owned by their existing pipelines.

## Renderer composition and lifecycle

`render-server.js` constructs one instance of each extracted factory, at the
existing initialization points. Dependencies point from the composition root to
the modules; extracted modules never import the server or start an HTTP listener.

- `runtime/browser.js`: owns the existing browser/context promises, recovery on
  disconnect, and explicit reset. Match still shares one 1080×1350 context with
  device scale factor 2; News retains its existing context behavior.
- `runtime/image-export.js`: owns the capture-policy state and lazy grain
  promise. Native capture is still 2160×2700 PNG, without resampling. Legacy JPEG
  remains 1080×1350, Lanczos3, quality 97, sRGB, 4:4:4, with grain disabled by the
  unchanged setting. PNG-only requests still skip compatibility JPEG work.
- `assets-runtime/logo-cache.js`: owns the same bounded single-flight instance,
  disk cache paths/age, validated download, stale fallback and transparent
  fallback. The root injects its existing security adapter, preserving injection
  boundaries as well as production validation.
- `news/http-handler.js`: accepts the existing injected News renderer; it does
  not own browser state, admission gates, metrics, deadlines or shutdown.

The server retains request IDs, authentication, admission, cancellation, Match
composition, font-request guard/cache, warmup, metrics and drain orchestration.
Keep lifecycle ownership there rather than introducing hidden per-request
browser instances. Asset paths continue to resolve from the renderer root,
not from the new modules' directories.

## Locating changes and extending the project

| Task | Primary location |
| --- | --- |
| Match dashboard mutations | `src/features/match/dashboard/actions.ts` |
| Dashboard messages | `src/features/match/dashboard/messages.ts` |
| Editor controls/options/contracts | `src/features/match/template-editor/` |
| Builder defaults/validation | `src/lib/match/template-builder/` |
| Builder generated HTML | `src/lib/template-builder.ts` |
| Match list/date filtering | `scripts/lib/match-list.mjs`, `selection.mjs`, `football/time.mjs` |
| Match live/final delivery | `scripts/lib/worker-core.mjs`, `live-checkpoint.mjs` |
| Event classification and icons | `scripts/lib/events.mjs` |
| News Telegram workflows | `scripts/lib/news-core.mjs`, `src/lib/news/` |
| Browser lifecycle/capture | `render/runtime/` |
| Logo download/cache | `render/assets-runtime/logo-cache.js` |
| News renderer HTTP protocol | `render/news/http-handler.js`, `src/lib/news/render.ts` |
| Startup/build guard | Root BAT files, `scripts/production-build-guard.mjs` |

Keep feature-specific code near its feature; share only genuinely common,
behaviorally identical infrastructure. Use descriptive kebab-case filenames,
explicit contracts and existing public facades. Do not create generic layers
solely to shorten a file, merge similar-but-different pipelines, or move state
into a module that can be evaluated more than once. Preserve initialization
order, dynamic imports, server/client directives and resource ownership.

## Verification and intentional remaining boundaries

Use `npm run typecheck` and `npm test`; on low-memory Windows machines use
`npm.cmd` and sequential Vitest workers (`--maxWorkers=1 --no-file-parallelism`).
Browser tests require installed Chromium and sufficient available RAM. Tests
mock external delivery/database operations; never start production managers for
verification. No lint script is configured. Use `npm run build` for production
verification so the existing prebuild/postbuild guard participates.

Template composition, event reconciliation, bot managers and worker orchestration
remain cohesive stateful modules. Their existing behavior is deliberately not
rewritten or consolidated. Web and standalone database/Telegram adapters also
remain separate because their lifecycle and runtime contracts differ.

The production guard fingerprints source files. Any refactoring invalidates a
previous production build; a fresh successful build is required before the
production launcher can be used. Neither launcher is changed or activated here.

## Local refactoring verification (2026-11-27)

- Before editing: both TypeScript configurations passed; 210 focused tests in
  eight files passed. An initial all-suite attempt was bounded and stopped when
  it produced no completed-file results under memory pressure. There is no
  claimed complete pre-refactoring test/build baseline.
- After refactoring: all 60 test files were covered in sequential batches:
  847 tests passed and one existing optional test was skipped because its local
  `tests/fixtures/photos/IMG_8334.JPG` source image was absent. No production
  integration was invoked; Telegram/database verification used mocks.
- Both TypeScript configurations passed. The Next.js 16.4.6 production build
  completed, including its existing prebuild/postbuild success guard; guard
  verification subsequently accepted the resulting build. No lint command is
  configured.
- Baseline/current builder output was byte-identical for 1,006 configurations.
  All five extracted editor components produced identical server-rendered HTML.
- Real Chromium baseline/current context and capture functions produced
  identical decoded pixels for Classic, Panel, Frame and Stripe with local fonts
  and fictional sample inputs, at 2160×2700 PNG. This comparison isolates the
  moved runtime/capture code; it does not assert a before/after HTTP screenshot
  comparison for every possible user template. Existing actual HTTP renderer
  tests separately covered News layouts, editorial layouts and standings.
- A static runtime dependency scan after erasing TypeScript-only imports found
  123 production modules, 238 local edges, and no cycles. Computed runtime import
  strings and external package internals are outside that static scan.
- Original pending News changes remained byte-identical; the pending renderer
  error mapping was preserved in the extracted News HTTP handler. Launchers,
  dependency manifests, configuration, schema and runtime assets were unchanged.

No detected behavioral differences remain. Live Telegram/production database
checks and production activation were intentionally not performed. These local
results do not establish production service health or authorize publication.
