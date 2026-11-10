# Telegram League Standings

## Release state

The Telegram collection workflow, provider-neutral service, safe raster renderer and local fictional previews are implemented. **Live generation is deliberately disabled.** `createNewsHandler` defaults to `createStandingsService(null)`. The News manager supplies no live provider. No environment switch, API-Football fallback, historical fallback or fictional production fallback exists. No paid service is used.

To enable later: approve the selected source and its intended graphics use, verify a free account against all five current-season tables, establish usable crest rights, implement its bounded server-side HTTP adapter with rate admission/timeouts and approved raster assets, and review/test that wiring in a separate change. A registered API token alone does not constitute permission to use crests. Do not put credentials in Telegram or source code.

## Provider investigation (2026-11-11)

### football-data.org: leading candidate, not live-verified for this account

- [Free pricing](https://www.football-data.org/pricing): EUR 0/month, 12 competitions, league tables, 10 calls/minute; scores are delayed. A free registered key is required.
- [Free coverage](https://www.football-data.org/coverage): Premier League (`PL`), La Liga (`PD`), Serie A (`SA`), Bundesliga (`BL1`), Ligue 1 (`FL1`) are explicitly listed.
- [Standings documentation](https://docs.football-data.org/general/v4/competition.html): official running-season standings, TOTAL/HOME/AWAY tables. Current-season eligibility is documented; successful authenticated access for this application is **not verified**, since no approved key was supplied for this integration. Do not treat old example JSON as live evidence.
- [Terms](https://www.football-data.org/about): registration, one-application scope, fair use, required attribution, and separate rights-holder consent for graphics. There is no explicit Instagram graphic redistribution clause in the reviewed terms. Obtain clarification for automated public graphics; do not describe a blanket social-media/crest licence as verified. Attribution is retained in the mapped table source and rendered footer/document caption.

### TheSportsDB: live current season, insufficient free table coverage

- [Free documentation](https://api.thesportsdb.com/documentation) and [pricing](https://api.thesportsdb.com/docs_pricing): public v1 key `123`, no registration needed for the shared key, 30 requests/minute, endpoint-specific result truncation. Dedicated production keys/premium features are paid and are not used here.
- Actual bounded read-only requests to `lookuptable.php` with season `2026-2027` returned HTTP 200 for Premier League (4328), La Liga (4335), Serie A (4332), Bundesliga (4331), and Ligue 1 (4334). Each returned **exactly five rows, positions 1-5**. This proves those current-season rows are accessible, not that the complete league is free. It cannot fulfill arbitrary positions such as 15-18. No pagination/filter workaround is assumed or used to evade free limits.
- [Terms](https://www.thesportsdb.com/docs_terms_of_use.php): free development use is described; content/image-specific licensing and third-party rights remain applicable. Logos must be used as-is, and API access does not grant third-party trademark permission. Production automated Instagram reuse is not asserted as cleared.

### Existing API-Football

Owner/support confirmed Free access is limited to seasons 2022-2024. It is not suitable for current standings. The Match client, key, daily accounting and integration remain unchanged.

## User workflow

Authorized, linked private chat only:

```text
[background photo or image document]
Caption: Premier League 15 16 17 18
```

A two-line caption also works. Conversation alternatives:

1. Send a background photo; then `Premier League`; then `15 16 17 18`.
2. Send `/standings`; provide the league, positions and photo as prompted.
3. Send `/standings La Liga 1 5 10 20`; then send the photo.

Use `/cancel` to return to ordinary News. Recognized league names: Premier League/EPL, La Liga/LaLiga, Serie A, Bundesliga, Ligue 1. Positions are unique positive integers in requested order and are checked against the complete actual table. Unsupported leagues or malformed positions receive a prompt; no guessing/fallback occurs. Collection expires after one hour. Existing ordinary News captions and commands remain intact outside standings mode.

With live generation disabled, a complete request receives an explicit source-approval message **before downloading or rendering the photo**. No sample is sent to Telegram.

## Data and rendering architecture

- `src/lib/news/standings.ts`: common table/provider contract, complete rank/team validation, season/date checks, position parsing, pure conversation transitions, maximum five cache keys, in-flight coalescing and 15-minute cache. No stale fallback. Selected results are copied so callers cannot mutate cached tables.
- `src/lib/news/standings-adapters.ts`: pure football-data.org DTO mapper; one unambiguous regular-season TOTAL table only, expected complete team count from trusted competition metadata, and pre-approved raster bytes. No network or credential integration is enabled.
- `scripts/lib/news-core.mjs`: existing linked-chat ownership checks, durable update claim, state persistence, sending recheck and at-most-once document delivery wrap the new flow. Ambiguous delivery is not automatically retried. Provider errors are sanitized. The production News manager already processes each bot's updates sequentially under its existing database lock.
- `src/lib/news/standings-html.ts`: bottom-aligned dark table, shared league-ID accents, rank/crest/name/P/GD/PTS, source/season/retrieval footer. Dynamic rows, preserved order and long-name fitting. Raster assets only, escaped text, embedded fonts, strict page CSP. Missing data/crests fail rather than inventing them.
- Existing authenticated `/render-news`, bounded request body, queue/admission, page deadlines, isolated browser context and network restrictions are reused. Crests are bounded to 1024x1024, animation is rejected and assets are decoded/re-encoded as PNG before embedding. No URLs or SVG are accepted as table crests.
- Full background uses `object-fit: contain` with neutral canvas where needed, preserving composition rather than automatically cropping. Phone orientation normalization is unchanged. Chromium 2160x2700 and shared 1080x1350 JPEG quality 97 / 4:4:4 / embedded sRGB export are reused.
- No database schema, web form, Match templates, OCI files, production configuration or Telegram credentials change.

## Private previews and verification

Run from the isolated project root with existing dependencies and Playwright Chromium:

```powershell
node scripts/preview-standings.mjs
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

The preview generator runs a temporary local renderer on an ephemeral port with a synthetic key, no production database and no external API. It generates 2-, 3-, and 4-row fictional samples and a contact sheet under git-ignored `preview-images/standings/`. Labels explicitly state fictional data; backgrounds and crests are synthetic. No photos, previews, ZIPs or contact sheets are committed or uploaded. Existing preview files are not deleted. The real renderer tests also cover a full 20-row table. These are renderer/Telegram mock integration checks, not a verified live provider or real Telegram delivery.

### Verified local results

- Full JavaScript/TypeScript suite: **577 tests passed, 45 files**, with `npm.cmd exec vitest run -- --maxWorkers=2`. An unrestricted parallel run timed out in the existing Match layout test under concurrent browser/build load; no test timeout was increased or disabled. Reducing worker contention allowed the complete suite to pass.
- Focused News/standings/real-renderer checks: **36 passed**. Runtime checks caught and corrected native Node strip-only incompatibility before final validation.
- `npm.cmd run typecheck`: passed for application and tests.
- Production build: `npm.cmd run build -- --webpack` passed. Default local Turbopack could not resolve dependencies through this isolated worktree's external node_modules junction; no deployment/build configuration was changed to accommodate that local setup.
- Generated and inspected actual 1080x1350 JPEG examples with 2/3/4 rows and a contact sheet. Real renderer tests additionally cover 20 rows, 4:4:4 output, embedded ICC and unsafe SVG rejection.
- No live provider or real Telegram delivery has been verified. Five TheSportsDB read-only requests verified only its five-row limitation. Match API-Football and OCI are unchanged.
