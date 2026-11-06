# Renderer review fixes - implementation results

Date: 2026-11-06. Main project only. Addresses R1-R4 in [the independent review](./RENDERER_SECURITY_REVIEW.md). Ready for independent code review; not deployed or activated.

## Exact changes

- [render/security.js](../render/security.js): normalize remote image URLs with the URL parser; add metadata-only Match image validation. Limits: 20 MiB local/decoded data-image bytes, 8,000 pixels per side, 25 million total frame pixels, at most 100 frames; existing tighter remote-logo/request limits remain. Accepted formats remain JPEG, PNG, WebP, GIF and SVG. A bounded 128-entry metadata cache avoids repeated parsing and excludes EXIF/ICC/XMP buffers. Local cache keys include size, modification time and change time.
- [render/render-server.js](../render/render-server.js): dispatch canonical HTTP(S) sources through the existing pinned downloader; validate downloaded/cache/local/data images, brand logos and detected embedded custom-template data images before Chromium uses them. Reuse validated background metadata. Retry Match work on a new page without closing the shared browser. Add a UUID to each Match HTML/JPG basename, preserving the fixture prefix for diagnostics.
- [render/template-check.js](../render/template-check.js): export the existing URL collector so the renderer can validate embedded image data; no template-validation policy redesign.
- [tests/render-images.test.ts](../tests/render-images.test.ts): new image-format, pixel/dimension, malformed-input, file-size and metadata-cache invalidation regressions. Oversized PNG tests modify headers rather than allocating giant decoded images.
- [tests/render-server.test.ts](../tests/render-server.test.ts): exercise noncanonical URL dispatch, image rejection, concurrent News survival through one-time and terminal Match failures, and distinct HTML/JPG results for concurrent same-ID requests. Fixtures now use valid images instead of placeholder invalid SVG bytes.
- [tests/helpers/fake-playwright.cjs](../tests/helpers/fake-playwright.cjs): deterministic per-request pixels and controlled browser/failure overlap for those tests. Only test processes load this helper.

No template, font, client, authentication, bot conversation, dependency, environment or database changes. The shared persistent Chromium architecture and normal capture/export settings remain intact. No service was stopped, restarted or deployed.

## Validation completed

- Focused tests: **60 passed across 3 files** (render-security, render-images, render-server).
- Application and test TypeScript checks: **passed**, with incremental output disabled.
- Edited runtime JavaScript syntax checks: passed.
- Real Chromium visual comparison: **all 8 outputs byte-identical**, zero differing pixels, 1080 x 1350 JPEG. Match Classic/Panel/Frame/Stripe and News single/left/right/breaking used identical before/after inputs, the same warmed browser/Match context and the same captured grain fixture. Only isolated test renderers were used. This checks these fixtures, not every possible customer template/image.
- [Raw comparison results](../storage/renderer-review-fixes/visual-results.json) and [before/after JPGs](../storage/renderer-review-fixes/visuals/) are retained in ignored main-project storage.
- One initial test failure was an empty-directory cleanup API error; corrected, then the focused set passed. No application failure was hidden. The visual script emitted Node's existing typeless-package warning; package configuration was intentionally unchanged.
- The existing live website, renderer, Match manager and worker retained their original PIDs/start times. Full tests, production build and live Telegram tests were not rerun. No new latency benchmark or production performance claim is made.

## Remaining limits and review notes

- Page-only retries cannot repair every browser-wide hang. A real Chromium crash still affects all contexts; existing disconnect handling recreates Chromium on subsequent work. Explicit whole-browser shutdown remains confined to the private test-child shutdown path. Do not restore unconditional browser resets inside request retries.
- Metadata/pixel limits reduce image-memory abuse; they are not a complete sandbox for arbitrarily expensive SVG/custom CSS or a hard end-to-end render deadline. Oversized or malformed inputs that previously reached Chromium now fail validation (remote logo failures retain the established safe fallback behavior).
- Unique filenames prevent collisions but retain a separate output for each request. Storage retention/cleanup was not changed; monitor disk usage and review retention separately rather than deleting user posts here.
- Cursor/delivery crash-window limitations and the other Stage 1/Stage 2 findings are unchanged. Live behavior remains unverified for this revision because activation is not approved.
- Refresh deployment fingerprints/rollback scope before any later activation: this revision also touches template-check.js and security.js. Do not execute a stale release manifest. The original review remains a historical record of the pre-fix findings.

**Stop point:** implementation and focused verification complete. Independent review and separate explicit activation approval are still required; no activation commands were run.


## Independent re-review follow-up: three R2 bypasses

Date: 2026-11-06. This section supersedes the earlier R2 completion claim for the three additional bypasses demonstrated in the independent re-review. The original four-fix implementation/results above remain historical evidence.

### Exact changes in this follow-up

- [render/template-check.js](../render/template-check.js): conservatively reject raw backslashes and their numeric/named HTML encodings in custom HTML. This prevents escaped CSS function names from bypassing URL discovery. Escaped/custom-template backslash syntax is intentionally unsupported; use literal CSS identifiers instead. Existing eight templates and generated template-builder HTML remain accepted.
- [render/security.js](../render/security.js): inspect bounded original image bytes before caching metadata. Walk PNG chunk boundaries and reject APNG animation chunks (acTL/fcTL/fdAT), truncated chunks and invalid endings, independently of Sharp's page count. Ordinary static PNG decoding/export is unchanged.
- The same helper now permits a self-contained UTF-8 vector SVG subset: shapes, text, gradients and internal fragment references. Reject nested image/feImage/foreignObject/script elements, external references/CSS resources, data resources, DTD/entities, numeric character-reference indirection, backslash escapes and unsupported encodings. Conservative rejection avoids implementing a recursive SVG/resource parser. Ordinary generated vectors retain their original bytes.
- Accepted local image bytes are read only on a metadata-cache miss; the existing 128-entry cache remains. These are container/metadata checks, not image re-encoding. No new dependencies.
- Runtime changes are confined to those two files. Browser lifecycle/retries, renderer HTTP code, News renderer, Match/News clients, templates/fonts, bot conversations and configuration are unchanged.

### Regression coverage and results

- Added cases to [template-check tests](../tests/template-check.test.ts), [image validation tests](../tests/render-images.test.ts) and [renderer HTTP tests](../tests/render-server.test.ts).
- Added [small APNG fixture builder](../tests/helpers/image-fixtures.ts): valid 1x1 frames with proper PNG chunks/CRCs. Tests reject APNG containers declaring 1, 2 and 101 frames without allocating large images.
- Coverage includes escaped CSS identifiers, HTML-encoded backslashes, embedded/namespaced SVG images, feImage, CSS data resources, entities, UTF-16, misleading local extensions, direct downloaded-byte validation, data URLs, and HTTP rejection. Vector shapes/text/gradients/internal uses and ordinary JPEG/PNG/WebP/GIF remain accepted.
- **123 relevant tests passed across six files:** template-check, template-input, template-builder, render-images, render-security and render-server. No full suite was run.
- Application/test TypeScript and runtime JS syntax checks passed. No production build was run.
- **All eight before/after JPG pairs are byte-identical**, zero differing pixels, 1080 x 1350 JPEG, with identical inputs, a shared warmed test-owned Chromium/Match context and identical grain fixture. [Raw results](../storage/renderer-r2-followup/visual-results.json) and [comparison images](../storage/renderer-r2-followup/visuals/) are retained in ignored storage. No fresh latency benchmark is claimed.
- The existing live renderer/website/Match manager/worker PIDs and start times were unchanged. No database, environment configuration, credentials, service or deployment changes were made. Temporary test processes used dummy keys and no production datasource.

### Remaining limits and readiness

These three bypasses are implemented and ready for independent review; activation remains unapproved. The intentionally stricter input policy rejects APNGs, SVGs with nested resources/unsupported XML features, and escaped custom-template syntax that may previously have rendered. It does not redesign or alter valid existing post output.

Metadata limits are not a general CPU/complexity sandbox for arbitrary vector/CSS content, and a genuine shared Chromium crash can still affect concurrent work. Existing request/delivery crash windows and output-retention limitations remain. No live Telegram or manual Google flow was exercised. Refresh activation/rollback fingerprints to include the final reviewed code before later deployment; do not run a stale manifest. No activation command was executed.


## Final HTML-character-reference bypass fix

Date: 2026-11-06. Addresses the confirmed u&#114;l(...) style-attribute bypass from the final narrow review.

- Runtime change: nine lines in [render/template-check.js](../render/template-check.js). Before URL collection, reject numeric, named and ambiguous character-reference candidates in tag/attribute source and style blocks, including inline SVG style text. Safe &amp; remains supported for normal query strings. This is conservative rejection, not a partial HTML decoder. Existing backslash checks remain.
- Both [template saving](../src/lib/template-input.ts) and [render request validation](../render/render-server.js) already call this validator before accepting/collecting image resources, so no renderer, client or browser-lifecycle edits were needed.
- Added regressions in [template-check tests](../tests/template-check.test.ts) and [renderer HTTP tests](../tests/render-server.test.ts): decimal/hex/uppercase hex/leading zeros, missing semicolons, fully encoded identifiers, named URL punctuation, unquoted/uppercase style attributes, SVG presentation attributes and SVG style text. Compatibility cases preserve ordinary CSS, Google Fonts raw/escaped ampersands and entities in ordinary text.
- **94 relevant tests passed across four files:** template-check, template-input, template-builder and render-server. An initial quoting error in a new fixture was corrected; only the affected test file was rerun, preserving the other three successful results. Application TypeScript passed; test TypeScript passed after that fixture correction. Runtime syntax check passed. No full suite or production build.
- Actual Chromium parsing confirmed six previously accepted forms produce image references in the browser while the updated validator rejects all six. Probes used only 1x1 in-memory images and a disposable network-blocked browser.
- **All eight JPG template pairs remain byte-identical**, zero differing pixels, 1080 x 1350 JPEG. The targeted comparison used identical inputs, warmed test-owned persistent Chromium/shared Match context and the same grain fixture. [Results](../storage/renderer-entity-fix/visual-results.json) and [before/after JPGs](../storage/renderer-entity-fix/visuals/) are retained in ignored storage. A final comment-only clarification does not change the tested executable code.
- Existing live service PIDs/start times were unchanged. No database, credentials, environment configuration, deployment or activation changes. No new dependencies.

Compatibility limit: custom templates using encoded characters in attributes/styles (other than &amp;) now fail validation, including ambiguous spellings. Use literal CSS/URL syntax and UTF-8 attribute text. Normal text-node entities remain accepted. Existing APNG/SVG policy restrictions, general SVG/CSS complexity and genuine shared-browser-crash risks are unchanged.

Implementation is complete and ready for independent review. It does not authorize Stage 1 activation; refresh release fingerprints/rollback manifests before any separately approved deployment.

## Quote-aware markup boundary follow-up

Date: 2026-11-06. Supersedes the preceding boundary-completeness claim: quoted opening-tag content could hide the real inline SVG style body from the old style-block regular expression.

- [render/template-check.js](../render/template-check.js): replace independent tag/style boundary matching with one strict, quote-aware lexical scanner. Validation, attribute URL collection and CSP insertion now share the actual opening-tag boundaries. Quoted `>` and `</style>` strings cannot truncate the real style body. Unsupported browser error-recovery syntax, malformed attributes/comments, duplicate attributes and ambiguous raw-text/foreign-content boundaries fail closed. This is a supported markup subset, not a general HTML parser.
- Adjacent resource-boundary checks reject responsive image candidates (`srcset`/`imagesrcset`), unsupported CSS image functions, non-image placeholders in URL positions and embedded font MIME resources. A safe 1x1 fixture confirmed Chromium can decode a PNG labeled `data:font/woff` as an image; permitting that alias would evade the image-only metadata collection path. Ordinary validated `data:image` resources and the existing Google Fonts providers remain supported.
- [render/template-check.d.ts](../render/template-check.d.ts): declare the existing exported URL collector for regression tests. No renderer lifecycle, image helper, template, font, bot, authentication, dependency or configuration changes in this follow-up.
- Updated [template-check tests](../tests/template-check.test.ts) and [renderer HTTP tests](../tests/render-server.test.ts); added [Chromium boundary regressions](../tests/template-boundaries.test.ts). Coverage includes Astra's exact inline SVG/quoted-style case, quote/hex/named-reference variants, malformed adjacent boundaries, actual attribute collection, safe query ampersands/text entities/vector SVGs, CSP placement after quoted head attributes and the MIME-alias rejection. Browser probes use small fixtures, blocked network and disposable test-owned Chromium.
- **127 focused tests passed across six files:** template-check, template-input, template-builder, render-server, render-images and template-boundaries. Application and test TypeScript checks passed with incremental output disabled; edited runtime JavaScript syntax check passed. No full suite or production build was run.
- **All eight before/after JPG pairs are byte-identical**, zero differing pixels, 1080 x 1350 JPEG. Identical inputs used warmed test-owned Chromium/shared Match context and the same grain fixture. [Raw results](../storage/renderer-boundary-fix/visual-results.json) and [comparison images](../storage/renderer-boundary-fix/visuals/) are retained in ignored storage. No new latency benchmark is claimed.

Compatibility: ordinary vector SVG shapes, gradients/internal references, legitimate text entities, safe query-string ampersands and all eight built-in outputs remain supported. Malformed/ambiguous custom markup, embedded data fonts, responsive candidates and arbitrary text placeholders used as image URLs now fail validation. Use explicit validated image placeholders or supported data-image URLs and ordinary Google Fonts links instead.

Remaining limits are unchanged: accepted custom SVG/CSS is not a general CPU-complexity sandbox, and a genuine shared-browser crash can affect concurrent work. Delivery/cursor crash windows and output retention remain separate concerns. This implementation is ready for independent review; it is not live-activation approval. Refresh release/rollback fingerprints before separately approved activation. No live service, database, environment, credential, deployment or activation changes were made.

## CSS source tokenization and parsed SVG animation follow-up

Date: 2026-11-06. Addresses the two confirmed Medium findings from the final boundary review. This section supersedes the prior R2 completion claim.

- [render/template-check.js](../render/template-check.js): remove HTML-wide CSS URL/import regex collection. Enumerate each parsed style-element body, style attribute and image-bearing SVG presentation attribute separately. A bounded, nonrecursive CSS lexical scanner skips complete comments and ordinary strings, recognizes literal URL tokens, checks quoted/unquoted URL endings, and limits bracket nesting to 64 within the existing 200,000-character template limit. Neither an inert attribute nor a comment/string can consume another CSS source's resource. Existing renderer metadata checks now receive the previously hidden image URLs before Chromium is invoked.
- The scanner rejects unterminated comments/strings, malformed URL syntax, unsupported control/escape syntax, mismatched/deep nesting, alternative image functions and CSS import/charset/namespace directives. Use the existing Google Fonts stylesheet link instead of CSS imports. No stylesheet fetching or new dependency was added.
- SVG animation restrictions now inspect parsed tag names, including namespaced/case variants, and reject set/animate/animateTransform/animateMotion/animateColor/discard regardless of attribute order or quoted angle brackets. Static vector SVGs remain supported. Related forbidden-element, meta HTTP-directive and event-attribute checks now use the same parsed opening tags/attributes, rather than maintaining separate regex tag boundaries. CSP placement continues to use that shared scanner.
- Runtime changes are confined to the validator. The [render request call site](../render/render-server.js) still rejects invalid templates and validates collected data images before rendering; the [template-saving call site](../src/lib/template-input.ts) still uses the same validator. Browser lifecycle, persistent Chromium, renderer dimensions/quality, fonts/templates, bots, account linking and database/environment configuration were not changed.

Regression coverage: updated [template-check tests](../tests/template-check.test.ts), [HTTP renderer tests](../tests/render-server.test.ts) and [real Chromium boundary tests](../tests/template-boundaries.test.ts). Cases include both exact Astra decoys, CSS comment/string decoys, independent style bodies/attributes, SVG presentation attributes, custom-property image values, case/quote variants, all blocked animation elements, malformed CSS, bounded collection, quoted meta boundaries and compatibility. Small network-blocked browser fixtures prove that the real red pixel is rendered and its URI is collected; SVG animation that would otherwise load an image is rejected. HTTP tests use a tiny oversized-dimension SVG and confirm the hidden URLs reach image validation and return HTTP 400.

Validation:

- **155 focused tests passed across five files:** template-check, template-input, template-builder, render-server and template-boundaries. One newly added assertion initially expected an internal error string; corrected it to the existing sanitized public message and reran only the affected HTTP test file (26 passed). Other successful files were not repeated.
- Application and test TypeScript checks passed with incremental output disabled. Test TypeScript was checked again after that assertion/import correction. Runtime JavaScript syntax passed.
- **All eight JPG pairs are byte-identical**, zero differing pixels, 1080 x 1350 JPEG. Identical inputs, warmed test-owned persistent Chromium/shared Match context and the same grain fixture were used. [Results](../storage/renderer-css-token-fix/visual-results.json) and [comparison JPGs](../storage/renderer-css-token-fix/visuals/) remain in ignored storage. The final validator matches the snapshot used for comparison (SHA-256: 0ed6025b96985b870ec7790c4f79e2c83d48367184db5913ecd91881dec3a522).
- Additional small browser probes checked comment-separated identifiers/functions, quoted uppercase URLs, custom-property substitution and blocked standard/vendor image-set syntax. No newly permitted uncollected image was observed.
- No full test suite, production build, live Telegram test or fresh latency benchmark. No live service was restarted/stopped, and no database, credentials, environment or deployment changes were made.

Compatibility and remaining risks: ordinary vector SVGs, safe text entities/query ampersands and all built-in Match/News output remain unchanged. Unsupported animation and CSS constructs now fail closed; malformed CSS that Chromium previously repaired may need correction in a custom template. The supported lexical subset is not a general HTML/CSS sandbox or a bound on arbitrary vector/CSS rendering complexity. Existing trusted Google Fonts, shared-browser crash, delivery/cursor and output-retention assumptions remain unchanged. These two fixes are implemented and ready for independent review; Stage 1 remains inactive and requires separate approval. Refresh release/rollback fingerprints before any later activation.


## R2 architectural replacement: final parsed document + closed image manifest

Date: 2026-11-06. Supersedes the lexical-boundary completion claims above. Prepared only; no activation.

### Root cause and authoritative boundary

The stored template was checked before sequential placeholder substitution. A valid-looking source such as background-image:u{{EVENTS_CLASS}}rl(...) became an uncollected real URL after expansion. Independent lexical interpretations of HTML, CSS and Chromium also created repeated parser disagreements. Fixing individual encodings could not establish the boundary.

- New [final-document.js](../render/final-document.js) uses explicit production dependencies parse5 7.3.0 (HTML5 tree/foreign-content/entity parsing) and css-tree 3.1.0 (individual stylesheet/declaration/value ASTs). These are necessary security dependencies, not private Next.js internals. Installation used --ignore-scripts; no Prisma generation/migration hook ran. npm reported zero known dependency vulnerabilities at installation.
- Allowlisted HTML/SVG elements and namespaces; active/event/unsupported resource attributes, SVG animation, script-bearing elements, imports, unsupported image functions, escaped/ambiguous CSS and parser-error recovery are rejected. Ordinary HTML layout, vector shapes/gradients/internal references, SVG styles/foreignObject layout, text entities and font query ampersands are supported. Numeric/hex/named references are decoded by HTML5 before inspecting actual attribute CSS. Supported semicolonless references are decoded too. Documents must use UTF-8. Serialization is checked for a stable HTML5 round trip.
- [expandPlaceholders](../render/final-document.js) is a single pass: inserted values cannot become second-stage templates. Used in the renderer and sample/preview expansion. Validation is after the entire expansion AND league-logo class adjustment, immediately before writing the exact canonical document. No further interpolation occurs. Stored-source checking remains early feedback/defense in depth, not the security authority.
- New [custom-resources.js](../render/custom-resources.js) reads approved local files or embedded images into immutable buffers and applies the existing image validator to those exact bytes, including dimensions/pixels/frames, APNG rejection and self-contained SVG restrictions. Only approved logo/background/league directories are readable; output/rendered directories are excluded. Bounds: 128 distinct image references, 64 MiB aggregate image bytes, existing 20 MiB/per-image and decoded-image limits; existing document/request bounds also apply.
- Approved images are rewritten to content-addressed https://validated-template.invalid/ URLs. These URLs never reach a server or DNS: the page route fulfills exact manifest entries from the validated buffers. No image bytes are re-read from disk after validation. The page CSP excludes direct data:, file: and arbitrary HTTPS images. An uncollected or browser-only image interpretation therefore gets blocked rather than silently decoded. The route additionally permits only the exact main document and fixed Google provider stylesheet/font resource types; even font-host image requests are denied.
- [render-server.js](../render/render-server.js) applies this only to untrusted custom HTML. The trusted four Match templates and fixed-code News builder retain their rendering/CSP architecture, quality and persistent Chromium behavior. News does not accept arbitrary HTML/CSS: its validated settings feed the existing fixed layout, embedded raster images/fonts and intentional fitting script; applying an untrusted script-free sanitizer there would break its legitimate fitting behavior.
- [template previews](../src/lib/templates.ts) and [editor previews](../src/app/dashboard/add-template.tsx) use the same final HTML5/CSS parser after sample expansion. Previews remain empty-sandbox iframes with no scripts/external images. Their images stay embedded data: for browser display; server image metadata/immutable-manifest enforcement is authoritative at JPG rendering, not a claim of metadata inspection in the user's browser.

### Scope, compatibility and changed files

New: [final-document.js](../render/final-document.js), [declarations](../render/final-document.d.ts), [custom-resources.js](../render/custom-resources.js), [focused boundary tests](../tests/final-document.test.ts).

Updated: [render server](../render/render-server.js), [sample expansion](../src/lib/sample-match.ts), [preview helper](../src/lib/templates.ts), [editor](../src/app/dashboard/add-template.tsx), [package manifest](../package.json), [dependency lock](../package-lock.json), [HTTP tests](../tests/render-server.test.ts), [Template Builder tests](../tests/template-builder.test.ts), [fake browser resource types](../tests/helpers/fake-playwright.cjs), this report. No template/font assets changed. No H1/H2 source, schema/SQL, database, environment, secrets or live services changed.

All Template Builder options, presets/fonts and built-in-as-custom preview fixtures passed. Unsupported/nonstandard markup or CSS requiring browser error repair fails closed; this does not remove custom HTML or the Template Builder. The older editor check's existing restrictions still apply. Stored custom templates outside the tested supported subset require preview/manual acceptance before activation; production saved templates were not queried. Canonical HTML serialization may change source formatting; visual equality for every possible custom design is not claimed.

### Validation and remaining risks

- 167 unique focused tests passed across six files: final-document (11), render-server (27), template-boundaries (5), template-builder (8), template-check/template-input (116 combined). Only affected files were rerun. Initial parallel runs had two contention timeouts, two new assertion/expectation problems and an obsolete guard expectation; those were corrected and affected files passed with one worker. The expanded HTTP regression rejects the post-substitution oversized image before Chromium navigation.
- Regression classes include post-substitution URL/function assembly and context changes, nonrecursive values, entities (decimal/hex/named/semicolonless), comment/string/cross-attribute decoys, inline SVG styles/presentation attributes, animation/active markup, mutation-style HTML, CSS imports/alternate image functions, oversized/nested SVG resources, stable safe text/query entities and actual network-blocked Chromium manifest/CSP behavior.
- Application and test TypeScript checks passed with incremental files disabled; the new font-key test typing was corrected and test TypeScript rerun. Edited runtime JavaScript syntax checks passed. A targeted browser bundle compilation passed, confirming the shared parsers are browser-compatible. No production build or full test suite ran.
- All eight actual before/after built-in JPG pairs are byte-identical, zero differing pixels, 1080x1350 JPEG. Identical inputs, the same warmed test-owned persistent Chromium/Match context and grain fixture were used. [Raw results](../storage/renderer-final-boundary/visual-results.json) and [JPGs](../storage/renderer-final-boundary/visuals/) are retained in ignored test storage. The final subsequent guard/allowlist adjustments affect the custom path only, not these built-in image bytes. No claim of byte identity across arbitrary uploads, environments or Chromium/font versions.
- Complex vectors, filters and CSS can still consume significant CPU/memory within size/resource limits; this is not a general computational sandbox. A genuine Chromium crash can affect other jobs sharing the browser. Embedded images in browser previews do not receive server-side metadata inspection until JPG rendering. Google Fonts remains the existing fixed-provider availability/trust dependency. No live Telegram, Google login or production saved-template test was performed.

R2 is implemented and ready for one final independent review of the final-document/manifest/CSP boundary. This is not a claim of independent security approval or authorization to activate Stage 1. Refresh deployment/rollback fingerprints and install the locked parser dependencies in the eventual reviewed release. Do not deploy this working tree wholesale: unrelated H1/H2 work remains prepared and separately gated.
