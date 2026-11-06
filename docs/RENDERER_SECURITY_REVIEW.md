# Stage 1 renderer security review

Date: 2026-11-06. Scope: actual renderer/security implementation, Match/News clients and the input paths relevant to exploitability. Review only; no application/configuration edits, live requests, database access, service changes, builds, Chromium launches or full test run.

**Result: no Critical or High issue confirmed. Four Medium findings. I do not recommend Stage 1 activation yet: fix R1's confirmed SSRF boundary bypass first. R2 and R3 should also be addressed before allowing untrusted or concurrent customer traffic; R4 is a reproducible-by-interleaving correctness risk. This is a fresh source review, not reliance on the previous audit's conclusions.**

## Findings

### R1 ? Medium: noncanonical HTTPS URLs bypass the pinned downloader

**Location:** [render/render-server.js:195](../render/render-server.js#L195), [render/security.js:69](../render/security.js#L69); browser interception is omitted for built-ins at [render/render-server.js:618](../render/render-server.js#L618).

The localizer recognizes remote images with an anchored literal http(s):// regex. Otherwise imageSource accepts any URL that new URL parses as HTTP(S), then returns the original string. A leading-space HTTPS URL or https:host/path therefore bypasses DNS validation, pinning, redirect checks and download limits. Built-in templates pass it to Chromium; their CSP allows HTTPS images.

**Evidence:** ran the actual extracted localizeImage function with the real security helper and a mocked downloader. Both synthetic inputs returned unchanged with **zero downloader calls**. No network request was made. A private-resolving hostname can consequently be fetched by Chromium rather than rejected by the downloader. Normal TLS and CSP still apply: this is not a demonstrated HTTP metadata-service bypass. Exploitation requires control of a logo field reaching an authenticated render request (for example an upstream logo source or renderer caller); no anonymous website-to-renderer route or direct user control of API-Football logos was established. Custom templates' request guard blocks these arbitrary hosts.

**Minimal fix:** parse/canonicalize once and dispatch on the parsed protocol. All HTTP(S) sources must pass through downloadPublicResource and return a local/data image, never an unlocalized network URL. Alternatively reject noncanonical forms before dispatch. Add regression cases for leading whitespace and slash/backslash variants. Canonical existing inputs and cached image bytes need not change.

### R2 ? Medium: Match image byte limits do not limit decoded image resources

**Location:** [render/render-server.js:550](../render/render-server.js#L550), [render/render-server.js:589](../render/render-server.js#L589), [render/render-server.js:602](../render/render-server.js#L602). Reachable upload path: [scripts/bot.mjs:142](../scripts/bot.mjs#L142) and [scripts/lib/telegram.mjs:44](../scripts/lib/telegram.mjs#L44).

Match backgrounds are confined to an allowed path or accepted data URI but have no enforced dimensions/pixel budget before Chromium decodes them. Metadata is informational; even a Sharp validation error is caught and rendering continues. Telegram image documents can carry highly compressed large PNGs within the existing 15 MiB byte cap. A 10,000-by-10,000 image alone can require roughly 400 MB for one RGBA surface, before other buffers. Two active requests can exhaust browser/process memory and disrupt both generators. This can be accidental or caused by an authorized bot user; actual OOM was deliberately not induced. News already rejects excessive dimensions/pixel counts.

**Minimal fix:** enforce supported format, dimensions and a reasonable decoded-pixel budget before loading external Match raster images, including local/data/remote-cache inputs. Treat validation failures as input errors instead of continuing. Reuse the News-style metadata gate, preserve legitimate generated SVG assets/icons, and validate/cache immutable downloaded images once where possible. No re-encoding or layout changes are necessary for accepted inputs.

### R3 ? Medium: a Match retry closes the browser used by concurrent News jobs

**Location:** [render/render-server.js:631](../render/render-server.js#L631), [render/render-server.js:275](../render/render-server.js#L275); News shares that browser at [render/news-renderer.js:57](../render/news-renderer.js#L57).

Any Match navigation/capture error unconditionally resets the whole persistent browser. The gate allows two active jobs, so a separate News context is not sufficient isolation: closing its parent browser aborts the other request too. A slow custom-template/font load or screenshot failure during a News render can therefore lose that News result. News has already consumed its input state and does not automatically retry failed rendering ([scripts/lib/news-core.mjs:50](../scripts/lib/news-core.mjs#L50)). A browser reset can also abort another Match retry.

**Evidence:** source tracing plus an isolated mock invocation of the actual resetBrowser function confirmed whole-browser closure. No live failure injection or Telegram delivery was attempted. This is an existing failure-path issue retained in the reviewed hardening, not a claim that Stage 1 introduced it.

**Minimal fix:** retry page-specific failures using a fresh page/context on the same healthy browser. Reserve browser replacement for confirmed browser failure; coordinate replacement so a request cannot close a browser generation still serving another job. Keep persistent Chromium and the normal fast path. Add a focused concurrent Match-failure/News-success regression.

### R4 ? Medium: concurrent Match requests with the same fixture ID share mutable files

**Location:** [render/render-server.js:579](../render/render-server.js#L579), [render/render-server.js:583](../render/render-server.js#L583), [render/render-server.js:648](../render/render-server.js#L648). The website always uses the same sample ID per brand at [src/lib/render.ts:73](../src/lib/render.ts#L73).

Two accepted requests can write the same HTML/JPG paths. The first request yields before navigating/capturing, allowing the second to replace its HTML; a later JPG write can also replace the output before its caller reads it. Repeated sample requests during template edits can return the wrong version. This is not path traversal or demonstrated cross-account disclosure: normal clients scope IDs to their brand/selection. The current concurrency test uses different IDs and does not cover this interleaving. This existing race remains possible under the new two-job gate.

**Minimal fix:** append a server-generated per-request nonce to Match HTML/JPG filenames, keeping the fixture ID only as a diagnostic prefix. Return the unique path; both clients already consume the returned path. Add a same-ID concurrent request test with distinct content. Preserve user-generated posts and any existing retention policy.

## Controls that held up in this review

- Match and News render POSTs authenticate before expensive work; missing/wrong secrets fail closed, comparisons use timingSafeEqual, and the renderer binds to loopback. Both Match clients send the same existing header as News. No browser-side secret exposure was found in these call paths. Coordinated client/server activation remains required.
- Once used, the downloader rejects private/reserved IPs and mixed DNS results, pins validated socket addresses, revalidates redirects and caps time/streamed bytes. R1 is a dispatch bypass, not a demonstrated flaw in its pinning logic.
- Local image validation checks lexical containment before filesystem resolution and physical containment afterward. Filename sanitization prevents ordinary traversal. No confirmed script execution bypass was found through escaped Match text, restricted event SVG markup, custom-template validation plus interception/CSP, or escaped/normalized News HTML. This does not make arbitrary custom HTML a general-purpose sandbox.
- News embeds validated raster images and bundled fonts, blocks network/local-file requests, and normalizes style values. The shared 1080x1350, JPEG quality 93, 4:4:4 export and existing layout constants remain intact. No rendering or performance benchmark was rerun, so this review adds no new visual/performance measurements.
- Admission is bounded to two active/four queued jobs with 15-second queue expiry and 45 MiB bodies. These are not a complete render deadline: HTTP requestTimeout bounds receipt, clients give up after 120 seconds, and some browser/decode work can outlive that. Handle request cancellation/deadlines carefully in future resource-limit work; a timeout alone must not close another job's browser (R3).

## Evidence and limits

Read actual source and relevant existing tests. Executed only small, in-memory helper/mock probes for R1 and R3. Did not send hostile payloads to live services, fetch private addresses, induce memory exhaustion, render samples, or rerun suites. R2/R4 are code-path/interleaving findings; their proposed fixes still need focused regression tests and validation. No code or configuration was changed. Only this report was saved. Awaiting approval for fixes; activation remains unapproved.
