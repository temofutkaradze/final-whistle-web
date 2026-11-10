# Match reference fidelity — review and verification

Branch: `feat/match-reference-fidelity`. Baseline: `1f6882f` (latest main when work
started). No deployment, database, Oracle or Telegram production changes.

## Reference analysis

The six supplied individual JPGs use the existing **Classic** layout. They are
768x960 (4:5); the renderer's 1080x1350 uses the same aspect ratio. Existing
Classic already has the reference's Montserrat family, heavy central score,
mirrored team/event columns, white league logo, stacked italic branding and
lower dark gradient. Rebuilding those working elements would add differences.

Preserved geometry in CSS pixels: scoreboard width 900 at top 726; side logos
180x180; score 160px/900 weight; names normally 28px/800; events 24px/800 with
20px minutes. League lines remain at x=90 and 640, y=772.5, width=350, height=2.
No new glow, line shadow, crop, overlay, score style or decorative element was
introduced. The color chart shows gradients, so those replace the line's color
only. The other three Match templates have no equivalent Classic league-line
pair and keep their own existing designs.

**Sources missing:** clean original background photograph and separate original
brand asset. The uploaded JPGs already have lettering/logos/gradients baked in;
using one as a new background would double those elements. No attempt was made
to reconstruct/remove them or invent pixels. Full-photo pixel matching cannot
be verified without the original source assets. Text branding uses the existing
Classic typography; no replacement logo asset was fabricated.

## Scenario matrix

All rows refer to the supplied collage's visible fixture labels. Test fixtures
are synthetic reconstructions for presentation, not claims about real results.
Official scores always remain the supplied match scores; event lists never
recalculate or overwrite a result.

| Collage | Scenario / data trigger | Existing support | Display / changes |
|---|---|---|---|
| 9001 | Regular goals; repeated player ID | Yes | Group same player/category minutes in chronological order. |
| 9002 | Goal/Penalty and Goal/Missed Penalty | Yes | White goalpost/ball versus red goalpost/cross. A miss is not a goal or red card. |
| 9003 | Own goal with differing scorer/beneficiary team convention | Yes | Own-goal icon on beneficiary side; existing official-score reconciliation retained. |
| 9004 | Normal goals plus own goal | Yes | Same rule with mixed goals; duplicate records now reconciled before side inference. |
| 9005 | Own goals on both sides | Yes, convention may be ambiguous | Existing scorer-team fallback retained if both conventions fit. No new guess. |
| 9006 | Straight red and second-yellow dismissal | Yes | Red card versus stacked yellow/red. Duplicate descriptions of one dismissal collapse. |
| 9007 | 0-0 plus dismissals | Yes | Cards still display independently of goals; ordinary yellows do not. |
| 9008 | Multiword team/player names | Yes | Existing wrapping and abbreviation retained. |
| 9009 | Same displayed initial/surname, distinct player IDs | Yes | Separate rows for distinct IDs; same ID still groups. Raw IDs unavailable in collage. |
| 9010 | Added time, extra time, mixed normal/penalty goals | Yes | 45+2, 90+4, 105, 120+1; same player/different category stays separate. |
| 9011 | Goal minute but missing player | Yes | Show minute without an invented name or separator. |
| 9012 | Four scorers plus a red (five rows) | Yes | Existing priority/retention preserved; no overlap in rendered case. |
| 9013 | No display-worthy events | Yes | Yellow cards, substitutions, cancelled/disallowed goals remain omitted. |
| 9014 | Added-time scored penalty | Yes | Preserve elapsed+extra representation and white penalty icon. |
| 9015 | Nine goals, five home scorers, long team name | Partial | Five rows fit; real overflow of the long name fixed with bounded Classic-only name fitting. |
| 9016 | Normal/own/penalty/missed goals plus second yellow | Yes | Mixed icons preserved, duplicate dismissal removed; existing chronological order retained. |
| 9017 | Nonzero official score, unavailable scorer data | Yes | Score remains; scorer area stays empty. No invented event. |

Additional guards: stable home/away team IDs take precedence when both are
available, with legacy name-based fallback. Conflicting third-team IDs are
ignored. A yellow from an opponent or an unidentified player cannot turn a
straight red into a second-yellow dismissal. Missing/non-object match context
returns usable empty data rather than throwing.

Repeated goal records collapse only if the deduplicated per-side goal distribution
agrees with the official score under an existing own-goal convention. Legitimate or ambiguous two-goal same-minute
records remain intact. Exact duplicate cards and equivalent red/second-yellow
records for a known player's same dismissal collapse. Unknown players are not
merged by guesswork. No provider/football API request changes were needed.

## League-color mapping

Values below are sampled interior line pixels from the supplied color PNG,
not assumed official brand colors. Each side uses three gradient stops (left to
right, 0/50/100%). Sampling avoids the rounded/antialiased line endpoints.
Central configuration: [league-accents.js](../render/league-accents.js).

| API-Football ID | League | Left segment | Right segment |
|---|---|---|---|
| 140 | La Liga | #ff992e / #ff7c34 / #ff5f3a | #ff5e3a / #ff4d44 / #ff3b4e |
| 39 | Premier League | #6b2bff / #8933fa / #a63bf5 | #a63af3 / #c81ea4 / #e80154 |
| 135 | Serie A | #1457f0 / #157fec / #16a7e8 | #16a8e8 / #21c4ed / #2ce0f2 |
| 78 | Bundesliga | #a90110 / #bd0312 / #d10515 | #d30616 / #e92028 / #fe3a3a |
| 61 | Ligue 1 | #305bff / #5f59ff / #8e57ff | #9057ff / #c753d1 / #fd4fa4 |
| 2 | Champions League | #35efd1 / #22b8ff / #3c6cff | #3f6bff / #8a4dff / #ee4de8 |
| 5 | Nations League | #1ebaaf / #8bc86a / #f6d324 | #f9d324 / #f58c2f / #f0453b |
| Other/missing | Unknown | Original rgba(255,255,255,0.45) | Same |

The worker now passes the stored numeric league ID. Legacy requests may still
use the league ID in their logo URL. Explicit unknown IDs remain white even if
a contradictory logo URL names another league. Team/league logos themselves
are unchanged. Existing local white-logo assets are retained.

## Implementation and security scope

- [Classic template](../render/templates/classic.html): two optional color
  placeholders; unchanged line geometry and normal typography.
- [League accents](../render/league-accents.js) and its declaration: immutable,
  ID-keyed reference samples; shared runtime/preview fallback.
- [Match layout](../render/match-layout.js) and its declaration: one bounded DOM
  measurement of two Classic names after fonts load. Only overflowing names
  shrink. Long-name case measured 20.5px versus unchanged 28px normal name;
  both stay inside their 240px boxes. No user HTML or resource injection.
- [Render server](../render/render-server.js): apply trusted palette tokens and
  Classic-only fitting. Customer templates skip fitting. Persistent Chromium,
  final custom-template validation, manifests, CSP, downloader, authorization,
  deadlines and export settings remain intact.
- [Events](../scripts/lib/events.mjs): conservative duplicate handling,
  team-aware dismissals and optional stable team IDs; existing filtering/order.
- [Worker core](../scripts/lib/worker-core.mjs): propagate existing stored IDs.
  Claiming, authorization, delivery and retries are unchanged.
- [Template checker](../render/template-check.js) and
  [sample match](../src/lib/sample-match.ts): recognize/fill the two safe optional
  palette tokens; Template Builder settings and output are unchanged.
- Focused regression tests and fixtures cover all 17 reference scenarios,
  palette/fallback, real long-name layout, worker propagation and renderer HTML.
- [Local preview tool](../scripts/previews/match-references.mjs): starts/stops
  only its own ephemeral test renderers, never loads .env, DB or bot clients.

## Verification and previews

**297 tests passed across 11 relevant suites**, including events, reference
scenarios, real Chromium name fitting, worker core, render-server, lifecycle,
render security, template validation/boundaries/builder and real News rendering.
Application and test TypeScript checks passed. No dependency, Oracle, database,
authentication, bot command/conversation, deployment or website UI change.
No production build or external Telegram delivery was performed.

Real HTTP renderer generated 17 scenario JPGs and six league examples at
1080x1350 using the persistent 2x Chromium + Lanczos3 pipeline, JPEG 97, 4:4:4 and
embedded sRGB, without added grain or AI. Photo is the existing approved QA
sports fixture, not the missing original football photo. Its source was recorded
by the existing quality experiment as [CC0](https://pxhere.com/en/photo/1102099).
These are clearly synthetic layout demonstrations, not depictions of those
clubs/results. A/B/L badges in the scenario grid are intentionally labeled test
placeholders, not replacements for production logos. The La Liga example uses
actual public API-Football club/league logos via the existing safe downloader.

Generated review files are private local outputs, excluded from Git. Earlier local copies are preserved.

Before/after comparisons used actual HTTP renderer outputs and identical
synthetic inputs. Classic's unknown-league fallback (repeated after the fit
change), Panel, Stripe and all four News layouts were byte-identical: **7/8**.
Frame's saved HTML was byte-identical, but JPG text edges differed slightly:
mean absolute channel difference 0.017810 on the 0..255 scale, maximum 77 in
isolated edge pixels. This is not attributed to a proven cause; do not claim all
eight byte-identical. Frame source and exporter were not changed. The preview
script keeps comparison evidence and returns a nonzero status for this mismatch
rather than silently accepting it. Visual review of actual JPGs, contact sheet,
line colors and the corrected long-name case was performed.

Run locally from a checkout with installed dependencies and Chromium:

```powershell
node scripts/previews/match-references.mjs --background "C:\path\to\approved-clean-photo.jpg" --logos
```

Omit `--background` for the existing synthetic gradient. Omit `--logos` for the
explicit test badges. `--logos` downloads only public logo assets through the
existing renderer downloader, with no football API key. Outputs are retained
under ignored preview-images/run-<timestamp>; no automatic
cleanup or user-file deletion. Before/after comparison uses origin/main; no
source files or running production services are replaced. Keep the console
output and verification.json even if Frame byte equality fails.

## Remaining decisions / limitations

1. Individual JPGs show normal-goal ball icons, while the scenario collage and
   existing event formatter omit them. The current no-icon rule was preserved;
   approval is needed to add ordinary-goal icons.
2. Collage 9016 places some rows in an order unlike chronological order. The
   existing chronological/group-first-occurrence rule was preserved rather
   than introducing a special ordering guess.
3. Collage 9009 cannot prove whether same-name rows have the same player ID.
   Existing group-by-identity/category semantics remain; tests show distinct
   players can have the same abbreviated display name.
4. Missing raw own-goal conventions retain existing official-score inference and
   fallback when both conventions fit. No provider metadata was invented.
5. Clean background/brand assets are still needed for a full-photo comparison.
   No pixel-perfect matching is claimed, and the color chart's added glow was
   deliberately not introduced because only line color was requested.
6. Reference cases have at most five rows per side. Existing crowded-event
   priority is preserved (missed penalties/cards drop before goals). More than
   five distinct scoring rows are retained by the formatter but can exceed
   Classic's available footer height. A new extreme-overflow design policy needs
   separate approval; no unreferenced compression/truncation rule was invented.
7. Live authenticated Telegram/API-Football delivery was not exercised. Existing
   mocked worker/delivery and security tests passed; no real user received a test.


## Private local visual approval previews

**Design status: PENDING USER REVIEW.** Do not merge or deploy before approval.

Preview generation is local only. There is no preview Actions workflow or artifact
upload. Generated JPGs, contact sheets, ZIPs and mock-data outputs are not tracked.
Source scenario fixtures and regression tests remain in Git; they are executable
source inputs, not generated outputs.

From the repository root with Node dependencies, Chromium and Python installed:

```powershell
$Review = "preview-images/review-" + (Get-Date -Format "yyyyMMdd-HHmmss")
node scripts/previews/match-references.mjs --review-only --output-dir "$Review/rendered"
node scripts/previews/package-match-review.mjs --source "$Review/rendered" --output "$Review/bundle"
```

The default generator output is also a fresh `preview-images/run-<timestamp>`.
Optionally add `--background "C:\path\to\approved-photo.jpg" --logos` to the first
command. Without those options, existing synthetic backgrounds/test badges are
used. CLI generation and packaging reject destinations outside `preview-images/`.
The directory is git-ignored. Do not upload its contents to GitHub or Actions.

The local bundle contains 25 unmodified 1080x1350 JPGs (17 event scenarios and
eight league/fallback samples), a full-image contact sheet with external labels,
fictional scenario JSON/CSV and a README. A ZIP is created beside the bundle.
Existing output folders are never silently overwritten or deleted. Old ignored
`storage/` reviews remain available; `--inspect-existing` can still read them.

The actual isolated HTTP renderer is used, without production secrets, databases,
Telegram delivery or Oracle calls. No production rendering settings change.

### Earlier GitHub copies

Five generated files previously under `docs/previews/` and the preview-only CC0
photo are removed from the branch's current tracked tree, with local copies kept.
They remain in earlier PR commits; this is not a history purge. The prior Actions
artifact is separate from Git history and must be checked independently before
any explicitly approved remote cleanup. Removing the workflow prevents further
preview uploads. Ordinary source-only CI remains unchanged.
