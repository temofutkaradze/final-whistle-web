# Telegram League Standings

## Release state

The Telegram collection workflow, provider-neutral service and raster renderer now use football-data.org when the News manager has `FOOTBALL_DATA_API_KEY`. Without that server-side key, generation remains explicitly disabled. No paid API, API-Football standings fallback, historical fallback or fictional production fallback exists. No public Instagram publishing is implemented or enabled; delivery stays inside the authorized private Telegram chat.

**Rights caveat before public use:** authentication grants data access, not ownership of club or league crests. The provider requires attribution and says graphic rights remain with their owners. Obtain the necessary crest permissions and clarify automated Instagram/commercial redistribution for your intended use. This change does not assert that those rights are cleared. The image footer and Telegram caption retain the provider attribution. See the official terms below.

Configure the optional key in the deployment's existing server-side environment; never send it through Telegram or commit it. The local original environment was read for the approved verification only; it was not changed or copied into this worktree. No service was restarted or deployed.

## Authenticated live verification (2026-11-11)

The local key was present (value never logged). Authenticated requests to both `/v4/competitions/{code}/standings` and `/teams` returned HTTP 200 for every league, with matching current-season IDs/dates and no API error codes:

| League | Code | Season start | Season end | Full team count | Positions 15-18 |
| --- | --- | --- | --- | --- | --- |
| Premier League | PL | 2026-08-21 | 2027-05-30 | 20 | All present |
| La Liga | PD | 2026-08-16 | 2027-05-30 | 20 | All present |
| Serie A | SA | 2026-08-23 | 2027-05-30 | 20 | All present |
| Bundesliga | BL1 | 2026-08-28 | 2027-05-22 | 18 | All present |
| Ligue 1 | FL1 | 2026-08-22 | 2027-05-29 | 18 | All present |

Returned overall tables have `stage: REGULAR_SEASON`, `type: TOTAL`, and `group: Matchday`. The initial mapper incorrectly rejected that group label; it now accepts only the verified label or null, while rejecting ambiguous multiple totals or other group labels. All actual ranks were contiguous through the complete team count. No historical season parameter was sent.

Further live checks through the actual provider/service loaded all five complete tables and normalized their real league/club raster assets. Every league successfully selected `[15,16,17,18]`. A PL check also preserved `[18,15,16,17]` in that order and selected a single position from cache. It sent nothing to Telegram, wrote no standings dataset to the repository and published nothing. This is live API/asset validation, not proof of real Telegram delivery or reuse licensing.

## Champions League official ties and display-row selection (2026-11-11)

The registered Free account authenticates to `CL/standings` and `CL/teams`: both return HTTP 200, matching season dates **2026-09-08 through 2027-01-27**, and 36 unique teams. Supported overall table: competition type `CUP`, stage `LEAGUE_STAGE`, type `TOTAL`, group `League phase`. Group and knockout-stage substitutes remain rejected.

### Official rank is not a unique row index

UEFA's actual live table and football-data.org both display **AEK Athens and Leipzig jointly at 29**, then Sabah at 31. This is a legitimate provisional tie, not a demonstrated provider defect. The prior documentation calling it an upstream data blocker was incorrect: our unique-rank assumption was too restrictive.

UEFA explains that matchdays 1-7 apply the first five tiebreakers and retain equal rankings if those do not separate the teams, displaying the tied clubs alphabetically by UEFA abbreviated name. From matchday 8 the full criteria apply. Both clubs currently have 3 points, -6 GD, 5 goals, 2 away goals, 1 win and 0 away wins. Sources: [UEFA live standings and tiebreaker explanation](https://www.uefa.com/uefachampionsleague/standings/), [Article 18](https://documents.uefa.com/r/Regulations-of-the-UEFA-Champions-League-2026/27/Article-18-Equality-of-points-league-phase-Online).

For **UCL only**, user numbers select **1-based display rows** in the verified provider sequence. Official rank labels are preserved verbatim:

| Request | Selected teams | Displayed official ranks |
| --- | --- | --- |
| `UCL 28 29 30 31` | Villarreal, AEK Athens, Leipzig, Sabah | 28, 29, 29, 31 |
| `UCL 31 30 29` | Sabah, Leipzig, AEK Athens | 31, 29, 29 |
| `UCL 30` | Leipzig | 29 |

No team becomes officially 30th. Domestic requests still select official positions exactly as before. Duplicate user selection numbers are deduplicated in requested order; duplicated official ranks are retained as distinct teams. `/help`, `/start`, UCL collection prompts and the resulting document caption explain the distinction. The image shows official ranks, not generated row labels.

### Verified order and future limits

A fresh read-only comparison of **all 36 displayed rows** on UEFA.com against the authenticated API found matching clubs, sequence and official ranks. Repeated checks of the affected rows also agreed. However, the reviewed football-data.org documentation does **not** provide a permanent contract for tied array order; a snapshot cannot establish that guarantee.

The implementation therefore verifies order rather than silently trusting, sorting or renumbering it:

- The full current-season table must contain exactly 36 valid rows and the same unique team IDs as current-season competition team metadata.
- Official ranks must follow competition ranking in the supplied order: `28,29,29,31` is valid; shuffled rows, unexplained gaps and `28,29,29,30` are rejected.
- Each mapped UCL row retains an explicit `displayRow`. Selection copies rows by that index and preserves each original `position`. Selected subsets may be reordered by the user.
- Tied clubs must appear alphabetically by verified UEFA abbreviated names. `src/lib/news/ucl-order.ts` records the 36 current clubs' API-ID-to-UEFA-label associations verified from the live 2026/27 table. No synthetic names or inferred ranks are added to production.
- Unknown tied identities, ambiguous alphabetical comparisons, reversed tie order or a new season without reviewed abbreviation evidence fail with `STANDINGS_ORDER` before artwork loading. Unique IDs and row-count checks remain mandatory. Domestic validation is unchanged.

This is evidence-backed validation for the observed season and UEFA's published display convention, **not** a claim that the API promises forever to match UEFA or that every future name change is automatically verified. Review the label evidence for a new season, club branding change or reported ordering discrepancy. The safe alternative for an unverified tied order is to stop that generation and compare the official table/update the reviewed labels; never silently use array indices, sort provider rows, or invent a sporting rank.

Actual live checks through the integrated provider/service passed for `[28,29,30,31]` (official labels `[28,29,29,31]`) and `[31,30,29]` (labels `[31,29,29]`), with real normalized crests. No real Telegram message or public graphic was sent. Tests use fictional data and include tied/skipped ranks and actual rendering of both a 36-row table and a tied-rank subset. Rate admission, caching, attribution, image/security safeguards, and existing UCL accents are preserved.

## Provider investigation (2026-11-11)

### football-data.org: verified free current-season access for this account

- [Free pricing](https://www.football-data.org/pricing): EUR 0/month, 12 competitions, league tables, 10 calls/minute; scores are delayed. A free registered key is required.
- [Free coverage](https://www.football-data.org/coverage): Premier League (`PL`), La Liga (`PD`), Serie A (`SA`), Bundesliga (`BL1`), Ligue 1 (`FL1`) are explicitly listed.
- [Standings documentation](https://docs.football-data.org/general/v4/competition.html): official running-season standings, TOTAL/HOME/AWAY tables. Authenticated current-season access was verified for all five leagues as recorded above. Old documentation example JSON is not treated as live evidence.
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

Use `/cancel` to return to ordinary News. Recognized league names: Premier League/EPL, La Liga/LaLiga, Serie A, Bundesliga, Ligue 1, Champions League/UEFA Champions League/UCL/CL. Selection numbers are unique positive integers in requested order and are checked against the complete actual table. Domestic numbers mean official positions; UCL numbers mean display rows 1-36, with official tied ranks retained. Unsupported leagues or malformed positions receive a prompt; no guessing/fallback occurs. Collection expires after one hour. Existing ordinary News captions and commands remain intact outside standings mode.

If the key is missing, a complete request receives an explicit source-configuration message before downloading or rendering the photo. HTTP/authentication/rate-limit failures receive sanitized errors; no sample data is sent instead.

## Data and rendering architecture

- `src/lib/news/standings.ts`: common table/provider contract, competition-aware rank/team/order validation, season/date checks, selection parsing, pure conversation transitions, maximum six cache keys, in-flight coalescing and 15-minute cache. No stale fallback. Selected results are copied so callers cannot mutate cached tables.
- `src/lib/news/ucl-order.ts`: reviewed UEFA abbreviated-name evidence and fail-closed UCL row-order validation; never sorts or renumbers rows.
- `src/lib/news/standings-adapters.ts`: pure football-data.org DTO mapper; one unambiguous competition-appropriate overall TOTAL table only, expected complete team count from matching current-season teams metadata, and raster bytes.
- `src/lib/news/football-data.ts`: fixed HTTPS API origin, auth header only to that origin, redirects rejected for API calls, 15-second API deadlines and 512 KiB streamed JSON limit. At most ten admissions per rolling minute, including failures; 429 Retry-After cooldown, no automatic retry/queue, at most two concurrent table loads. Both standings and current teams metadata must match before artwork loading. Crest URLs must originate on the provider crest host; the existing DNS/SSRF-safe downloader bounds bytes/time and checks redirects. Existing SVG/APNG validation runs before rasterization. Crests become bounded PNGs and a maximum 128-entry, one-hour cache is shared across all account handlers. A single News manager owns the key budget; do not share this key with independent workers without shared admission. External use can cause 429s and is not hidden.
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

The preview generator runs a temporary local renderer on an ephemeral port with a synthetic key, no production database and no external API. It generates 2-, 3-, and 4-row fictional samples and a contact sheet under git-ignored `preview-images/standings/`. Labels explicitly state fictional data; backgrounds and crests are synthetic. No photos, previews, ZIPs or contact sheets are committed or uploaded. Existing preview files are not deleted. The real renderer tests also cover full 20-row and 36-row tables. These preview renders and Telegram tests use fictional data; live provider checks are recorded separately above. No real Telegram delivery is claimed.

### Verified local results

- Full JavaScript/TypeScript suite: **618 tests passed, 46 files**, with `npm.cmd exec vitest run -- --maxWorkers=2`. An unrestricted parallel run timed out in the existing Match layout test under concurrent browser/build load; no test timeout was increased or disabled. Reducing worker contention allowed the complete suite to pass.
- Provider regressions include verified domestic Matchday and UCL League phase labels, all six codes, 18-team, 20-team and 36-team tables, rejected group/knockout stages, official ties and valid skipped ranks, rejected inconsistent rank sequences, display-row selection and unknown/reversed tie-order guards, single-row selection, shared cache/in-flight behavior, 10/minute admission, 429 cooldowns, authentication failures, malformed/oversized data, season and team-set mismatches, unsafe artwork and concurrency. Existing News/standings/real-renderer checks passed as part of the complete suite.
- `npm.cmd run typecheck`: passed for application and tests.
- Production build: `npm.cmd run build -- --webpack` passed. Default local Turbopack could not resolve dependencies through this isolated worktree's external node_modules junction; no deployment/build configuration was changed to accommodate that local setup.
- Generated and inspected actual 1080x1350 JPEG examples with 2/3/4 rows and a contact sheet. Real renderer tests additionally cover 1, 20 and 36 rows, 4:4:4 output, embedded ICC and unsafe SVG rejection.
- Live football-data.org access and raster loading are verified above. Real Telegram delivery has not been exercised. Five TheSportsDB read-only requests verified only its five-row limitation. Match API-Football and OCI are unchanged.
