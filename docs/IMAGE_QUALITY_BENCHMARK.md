# Image-quality experiment and prepared settings

Prepared on `perf/image-quality-benchmark`, based on `origin/main` at `12c09a6`.
No production deployment, database access, Telegram sends, OCI changes, or PR #16 changes.

## Decision

- Shared Match/News JPEG quality: **97**, up from 93.
- Keep **4:4:4**, **1080x1350**, **2160x2700 capture**, and **Lanczos3**.
- Embed an **sRGB ICC profile**; do not retain source EXIF/private metadata.
- Disable the global Match grain (sigma 5 -> 0). News already disabled grain.
- Preserve every template, font, source download, crop, focal point, zoom, and News orientation normalization.
- No AI, denoising, sharpening, content-aware crop, or reconstructed photographic detail.

Runtime changes are confined to [the shared exporter](../render/render-server.js) plus an updated explanatory comment in [the News adapter](../render/news-renderer.js).

## Evidence and review images

- [Interactive comparison gallery](../storage/quality/results/index.html)
- [Before/after and enlarged detail sheets](../storage/quality/results/review/)
- [Complete measurements](../storage/quality/results/results.json)
- [Balanced summary](../storage/quality/results/summary.json)
- [Actual-exporter verification](../storage/quality/results/export-verification.json)
- [Sampled process-tree CPU/RAM](../storage/quality/results/process-metrics.json)

These generated outputs are deliberately ignored by Git and remain in this isolated worktree. They are not runtime assets. The recorded settings and measured summary below travel with the branch.

## Fixtures and methodology

All eight templates: Match classic/panel/frame/stripe; News single/left/right/breaking.
Four complete cases per template (32): synthetic 2160x2700 portrait chart; synthetic 3240x2160 landscape chart; existing 720x900 public JPEG example; a 2880x1920 sports-photo fixture. Charts contain a known jersey number 19, thin colored borders, badge, fine text and gradients. The existing public example is already composited/compressed and is not represented as an original photo.

The sports photograph is [PxHere 1102099](https://pxhere.com/en/photo/1102099), published under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). It contains real faces, badge detail and jersey numbers 29/10/83. Its original is 5760x3840; the bounded fixture is a single Lanczos3 reduction with no crop. Original SHA-256: `b8cea8e572803cfdbd3854271f0aca88cbf526b9998d9ec7870aaeabe3f2529b`. No sensitive customer photo was read.

The benchmark uses the actual baseline renderer compiled in memory, on ephemeral localhost ports with a synthetic renderer key and unusable localhost database URL. Browser/font responses are warmed and pinned in memory; no external requests are permitted during measured captures. Scale changes exist only in the test harness. The baseline commit is pinned so changing the exporter cannot silently change the baseline.

JPEG variants use identical lossless captures. References are clean, final-size, 2x/Lanczos3 RGB pixels. PSNR measures RGB error; SSIM is **non-overlapping 8x8 BT.709 luminance-window SSIM**, population variance, K1=.01/K2=.03, including partial edge blocks. It is not Gaussian-window reference SSIM. Metrics have focused tests for identity and analytically known errors. Grain uses fixed seeded Gaussian noise to eliminate random comparison differences. Encoders run three times; capture samples run twice after warm-up.

Kernel and scale scores measure differences from the chosen 2x/Lanczos3 reference, **not proof that this reference is objectively superior**. Decisions also use actual image inspection. No claim is made that PSNR/SSIM proves semantic identity, perceptual perfection, or Instagram's final delivery quality.

## Encoder comparison: 32 cases, no added grain

| Quality / chroma | Mean KiB | Mean PSNR dB | Mean SSIM-8 | Median JPEG-only ms | Median Node CPU ms |
|---|---:|---:|---:|---:|---:|
| 93 / 4:4:4 | 245.1 | 46.64 | .996893 | 45.2 | 47 |
| 95 / 4:4:4 | 294.9 | 47.90 | .997414 | 47.9 | 47 |
| 97 / 4:4:4 | 377.0 | 49.57 | .997991 | 52.2 | 47 |
| 100 / 4:4:4 | 736.1 | 52.11 | .998711 | 69.7 | 63 |
| 95 / 4:2:0 | 230.5 | 41.59 | .997137 | 28.6 | 31 |
| 97 / 4:2:0 | 285.9 | 42.05 | .997708 | 28.6 | 31 |
| 100 / 4:2:0 | 475.9 | 42.62 | .998435 | 38.3 | 31 |

Quality 97 offers lower pixel error at a modest absolute size; 100 is about 95% larger than 97. The 95-to-97 improvement is subtle and easiest to inspect at enlarged colored edges, rather than a dramatic improvement to faces at normal viewing size. 4:2:0 visibly damages saturated fine edges; retained 4:4:4. ICC attachment added 498 file bytes in the controlled Q95 comparison and **zero decoded-pixel differences**. Actual Q97 ICC outputs likewise match the measured Q97 candidate pixels in all 32 cases.

## Actual shared-exporter before/after

Measured using the actual old/new exporter functions on the same saved Chromium captures, three repetitions each. Each version runs in a fresh Node process. Includes PNG decoding, resize, color processing, optional grain and JPEG encode; excludes Chromium, downloads, Telegram and file IO.

| Pipeline (16 cases each) | Before | Prepared output |
|---|---:|---:|
| Match mean size | 295.1 KiB | 356.4 KiB (+20.8%) |
| Match mean PSNR / SSIM-8 against clean reference | 44.41 / .988159 | 49.80 / .997964 |
| Match median exporter wall / CPU | 440.0 / 624.5 ms | 290.3 / 305.0 ms |
| News mean size | 261.0 KiB | 398.5 KiB (+52.7%) |
| News mean PSNR / SSIM-8 | 46.30 / .996887 | 49.34 / .998018 |
| News median exporter wall / CPU | 200.1 / 227.0 ms | 252.1 / 281.0 ms |

Fresh exporter-process peak RSS was 188.1 MiB before and 173.4 MiB after. These are observed high-water marks including the verification harness, not a guaranteed memory reduction or full-application RAM figures. Native CPU time can exceed wall time due to parallel threads.

Match's dominant visible change is removal of added noise, particularly in flat colors, text and shadows. The photographic texture already present in the source remains. The inspected gradients did not show a compelling banding benefit from keeping full-frame grain. No denoising was applied. News improvements are subtler; composition, jersey shapes and text wrapping remain unchanged.

## Capture scale and filters

Paired capture comparison on the same two fixtures and selected four templates (classic/panel/left/breaking), including original baseline export work:

| Scale | Match median ms | News median ms |
|---|---:|---:|
| 1x | 2,490 | 4,549 |
| 2x | 5,568 | 8,626 |
| 3x | 12,073 | 14,796 |

1x was faster but showed rougher fine type/edges. 3x did not demonstrate a visual gain justifying its substantial cost. Keep 2x. Lanczos2, Mitchell and MKS2021 were compared on all 32 cases; none showed a consistent practical advantage over Lanczos3. Mitchell was softer on fine detail. No extra sharpening was added.

Windows sampled process-tree working-set peaks in the resumed run: 2x Match 685 MiB, 2x News 833 MiB; 3x Match 759 MiB, 3x News 953 MiB. These include the harness and sum shared pages; sampling may miss brief peaks. GC, caches and differing workloads prevent treating them as isolated marginal costs. Raw CPU samples are recorded by phase. Original stopped-run process samples were not fully persisted; no missing peak is fabricated.

## Limits of the experiment

- Windows x64, Intel i3-6006U, four logical CPUs, approximately 4 GB system RAM; Node 24.21.0. This is not an ARM/Oracle benchmark or a dedicated idle machine.
- An initial **22MP News stress run caused severe system memory pressure** (about 80 MiB free). Only the benchmark process tree was stopped. Completed original-size stress records are retained but excluded from balanced averages; the main matrix resumed with the clearly labeled 5.5MP fixture. Original-size News at peak/concurrent load remains unverified. This change does not solve full-resolution PNG preprocessing memory costs.
- Existing source sharpness, compression, camera noise, template overlays and geometric cropping remain. Nothing reconstructs missing details.
- No real Telegram delivery or Instagram upload was performed. Platform recompression and Linux/ARM rendering need separate approved deployment checks.
- Full-frame SSIM is dominated by broad regions. Enlarged detail sheets supplement it; not every source image, custom template, ICC input or display was tested.

## Reproduce safely

Use a fresh isolated checkout, installed locked dependencies, local Playwright Chromium and Python for Windows process sampling. Do not copy `.env` or start bots. Never run the large-source stress case on a shared low-memory machine. The ordinary benchmark uses bounded fixtures.

```powershell
node scripts/quality/fetch-fixture.mjs
node scripts/quality/benchmark.mjs
node scripts/quality/report.mjs --images
node scripts/quality/verify-export.mjs
```

`--resume` preserves completed measurements; a fresh ordinary run refuses to overwrite an existing results manifest. The public fixture fetch validates its pinned SHA-256. No new dependency is required. Output galleries and source photographs stay in ignored local storage.

## Validation

- Actual before exporter reproduced baseline JPEG bytes on all 32 cases.
- Actual after exporter matched measured candidate decoded pixels on all 32 cases; 1080x1350, 4:4:4, ICC present, EXIF absent.
- Actual full-size outputs and enlarged detail sheets were inspected for grain, text, gradients, face/jersey detail and scale/filter differences.
- **246 tests passed across 13 relevant files**, including renderer security, image validation, shared lifecycle/draining, operations, Match/News, template boundaries and benchmark metric tests. Executed with one Vitest worker on this memory-constrained laptop; no unrelated full-suite rerun.
- `npm.cmd run typecheck`: both application and test TypeScript checks passed.
- Prisma schema validation passed against an unusable localhost URL; no database connection/migration was performed.
- `npm.cmd run build`: production Next.js 16.4.3 Turbopack build passed (33.7s compilation, 11.4s build TypeScript). The isolated build used `NODE_OPTIONS=--max-old-space-size=1536`, dummy localhost database configuration and disabled telemetry only in the child shell. No environment files or deployment configuration changed.
- JavaScript/Python syntax and `git diff --check` passed.
- No benchmark or renderer-test processes remained after validation.

Changed files: `render/render-server.js`, the comment in `render/news-renderer.js`, `tests/render-server.test.ts`, `tests/news-renderer.test.ts`, new `tests/image-quality-metrics.test.ts`, this report, and the seven standalone helpers in `scripts/quality/` (`benchmark.mjs`, `fixtures.mjs`, `metrics.mjs`, `monitor.py`, `fetch-fixture.mjs`, `report.mjs`, `verify-export.mjs`). No dependencies, templates, application UI, authentication, databases, bots, workers or Oracle files changed.

Prepared changes are uncommitted/unpushed in the isolated worktree. Nothing was merged or deployed. Review the actual `*-after.jpg` files in the gallery before approving a release.
