// render-server.js
// A small, persistent local HTTP server. The worker (scripts/worker.mjs) and the dashboard call it
// (POST /render) to draw a result post with Playwright (Chromium) and get back a finished JPEG.
//
// It lives in this project (render/), so everything it needs is next to it:
//   render/templates/<name>.html   the built-in templates (classic, panel, frame, stripe)
//   render/assets/leagues/<id>.png optional white league logos (transparent background)
//   render/cache/logos/            downloaded team / league logos (created automatically)
//   render/rendered/, render/output/  generated HTML and JPEG files (created automatically)
//
// Start it with:  npm run render        (needs:  npm install  and  npx playwright install chromium)
// The port is RENDER_PORT from .env (default 4500).
//
// Rendering pipeline:
//   background (any size) -> CSS object-fit: cover inside the 1080x1350 layout
//   -> Chromium renders at deviceScaleFactor 2 => 2160x2700 physical pixels (kept in memory)
//   -> sharp downscales to exactly 1080x1350 (Lanczos3) -> sRGB JPEG, quality 93
//
// Speed notes (none of these change the picture):
//   * one long-lived Chromium + one shared browser context, warmed up at start-up
//   * team / league logos are cached on disk, so a render needs no network for them
//   * the 2160x2700 intermediate is never written to disk (see KEEP_PNG)
//   * the intermediate PNG is encoded with Chromium's fast encoder (lossless, same pixels)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const PORT = Number(process.env.RENDER_PORT) || 4500;

// Everything is looked up relative to this file, so the folder can live anywhere.
const ROOT = __dirname;
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const RENDERED_DIR = path.join(ROOT, 'rendered');
const OUTPUT_DIR = path.join(ROOT, 'output');
const DEFAULT_TEMPLATE = 'classic';

// Used when a request carries no page name.
const PAGE_NAME = 'final\nwhistle';

// Built-in template chosen by the request ("template": "panel"). Only plain names are accepted,
// so a request can never point at another folder. Unknown names fall back to the default one.
function templatePathFor(key) {
  const name = /^[a-z0-9_-]{1,40}$/.test(String(key || '')) ? String(key) : DEFAULT_TEMPLATE;
  const p = path.join(TEMPLATES_DIR, `${name}.html`);
  return fs.existsSync(p) ? p : path.join(TEMPLATES_DIR, `${DEFAULT_TEMPLATE}.html`);
}
const WARMUP_TEMPLATE_PATH = templatePathFor(DEFAULT_TEMPLATE);

// Final Instagram output
const FINAL_WIDTH = 1080;
const FINAL_HEIGHT = 1350;
const HIRES_WIDTH = FINAL_WIDTH * 2;   // 2160
const HIRES_HEIGHT = FINAL_HEIGHT * 2; // 2700
const JPEG_QUALITY = 93;
// Very light monochrome grain added after the downscale to hide banding in the dark gradient.
// 0 disables it. ~4-8 is subtle; raise only if banding is still visible.
const GRAIN_SIGMA = 5;

// The 2160x2700 PNG is only an in-memory step. Set to true to also save it next to the JPEG
// (slower, uses a lot of disk space).
const KEEP_PNG = false;

// League logo handling.
// By default the template turns every league logo into a flat white silhouette (CSS filter).
// That fails for logos made of a filled badge (they become a white block), so:
//  1) If render/assets/leagues/<league_id>.png exists, it is used as-is (no filter).
//     Put a hand-made WHITE version of the logo there (transparent background).
//  2) Leagues listed below keep their ORIGINAL colours (no white filter) until you add a white version.
const LEAGUE_LOGO_DIR = path.join(ROOT, 'assets', 'leagues');
const KEEP_ORIGINAL_COLOR_LEAGUES = new Set([135, 78]); // 135 = Serie A, 78 = Bundesliga

// Remote logos (team / league URLs coming from the API) are downloaded once and reused from disk.
// The picture is identical (same bytes); it just does not depend on the network at render time.
const LOGO_CACHE_DIR = path.join(ROOT, 'cache', 'logos');
const LOGO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // re-download after 14 days
const LOGO_DOWNLOAD_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------------------------
// Grain
// ---------------------------------------------------------------------------------------------

// Grain image is identical for every render, so it is generated once and reused.
let grainPromise = null;
function getGrain() {
  if (!grainPromise) {
    grainPromise = sharp({
      create: {
        width: FINAL_WIDTH,
        height: FINAL_HEIGHT,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: 'gaussian', mean: 128, sigma: GRAIN_SIGMA },
      },
    }).png().toBuffer();
  }
  return grainPromise;
}

// ---------------------------------------------------------------------------------------------
// Logo cache
// ---------------------------------------------------------------------------------------------

// <logo-cache>
const LOGO_EXTS = ['png', 'jpg', 'svg', 'webp', 'gif'];

function findCachedLogo(key, allowStale) {
  for (const ext of LOGO_EXTS) {
    const p = path.join(LOGO_CACHE_DIR, `${key}.${ext}`);
    try {
      const st = fs.statSync(p);
      if (allowStale || Date.now() - st.mtimeMs < LOGO_CACHE_MAX_AGE_MS) return p;
    } catch (e) { /* not cached with this extension */ }
  }
  return null;
}

function extFromContentType(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('svg')) return 'svg';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('png')) return 'png';
  const m = String(url).toLowerCase().match(/\.(png|jpe?g|svg|webp|gif)(\?|$)/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  return 'png';
}

// Returns a file:/// URL of a local copy of a remote image, or the original value when it is not
// an http(s) URL or anything goes wrong (then the browser simply loads it from the network as before).
async function localizeImage(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return url;
  const key = crypto.createHash('sha1').update(String(url)).digest('hex');
  const toFileUrl = (p) => pathToFileURL(p).href;
  try {
    const fresh = findCachedLogo(key, false);
    if (fresh) return toFileUrl(fresh);

    fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });
    const res = await fetch(String(url), { signal: AbortSignal.timeout(LOGO_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) throw new Error('response too small to be an image');

    const ext = extFromContentType(res.headers.get('content-type'), url);
    const finalPath = path.join(LOGO_CACHE_DIR, `${key}.${ext}`);
    const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, finalPath);
    return toFileUrl(finalPath);
  } catch (e) {
    // Download failed: an expired cached copy is still better than a broken image
    const stale = findCachedLogo(key, true);
    if (stale) {
      console.warn(`Logo download failed (${e.message}); using the older cached copy: ${url}`);
      return toFileUrl(stale);
    }
    console.warn(`Logo cache skipped (${e.message}); loading from the network: ${url}`);
    return url;
  }
}
// </logo-cache>

// ---------------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------------

let browserPromise = null;
let currentBrowser = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch()
      .then((browser) => {
        currentBrowser = browser;
        // If Chromium dies, start a fresh one on the next render instead of failing until a restart
        browser.on('disconnected', () => {
          if (currentBrowser === browser) {
            console.warn('Browser disconnected; a new one will be started on the next render.');
            browserPromise = null;
            contextPromise = null;
            currentBrowser = null;
          }
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// One shared browser context: its cache survives between renders, so the Google Fonts files are
// downloaded only once instead of on every render (faster and more reliable).
// CSS coordinate system stays 1080x1350; deviceScaleFactor 2 renders it at 2160x2700 physical pixels.
let contextPromise = null;
function getContext() {
  if (!contextPromise) {
    contextPromise = getBrowser()
      .then((browser) => browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 }))
      .catch((err) => {
        contextPromise = null;
        throw err;
      });
  }
  return contextPromise;
}

// Throw away a possibly stuck browser; the next getContext() starts a fresh one.
async function resetBrowser() {
  const b = browserPromise;
  browserPromise = null;
  contextPromise = null;
  currentBrowser = null;
  try { const browser = await b; if (browser) await browser.close(); } catch (e) { /* already gone */ }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------
// Screenshot (2160x2700) and final image (1080x1350 JPEG)
// ---------------------------------------------------------------------------------------------

// Same pixels as page.screenshot(): the PNG is lossless, we only ask Chromium for its fast PNG
// encoder because this PNG is just an in-memory step (file size does not matter).
// If that is unavailable or returns an unexpected size, the standard screenshot is used instead.
let useFastCapture = true;
async function captureHiRes(page, context) {
  if (useFastCapture) {
    let client = null;
    try {
      client = await context.newCDPSession(page);
      const { data } = await withTimeout(
        client.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }),
        60000,
        'fast screenshot'
      );
      const buf = Buffer.from(data, 'base64');
      const meta = await sharp(buf).metadata();
      if (meta.width === HIRES_WIDTH && meta.height === HIRES_HEIGHT) return buf;
      console.warn(`Fast capture returned ${meta.width}x${meta.height}; using the standard screenshot instead.`);
    } catch (e) {
      // A stall must go through the normal retry (fresh browser); anything else just means "not supported here"
      if (/timed out/.test(String(e.message))) throw e;
      console.warn('Fast capture not available, using the standard screenshot:', String(e.message).split('\n')[0]);
    } finally {
      if (client) await client.detach().catch(() => {});
    }
    useFastCapture = false;
  }
  return page.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 120000 });
}

// 2160x2700 PNG buffer -> 1080x1350 sRGB JPEG buffer (Lanczos3 downscale, light grain)
async function makeJpeg(pngBuffer) {
  let img = sharp(pngBuffer)
    .flatten({ background: '#000000' })          // no alpha channel in the JPEG
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb');
  if (GRAIN_SIGMA > 0) {
    img = img.composite([{ input: await getGrain(), blend: 'soft-light' }]);
  }
  return img.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' }).toBuffer();
}

// Wait until web fonts and every <img> (background, logos) are loaded and decoded, and one frame was painted,
// so nothing is captured with fallback fonts or half-loaded images.
async function waitUntilReady(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.decode ? img.decode().catch(() => {}) : Promise.resolve()
      )
    );
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise((r) => setTimeout(r, 500)),
    ]);
  });
}

// ---------------------------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/render') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. POST to /render.' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const d = JSON.parse(body);
      const t0 = Date.now();

      // fixture_id ends up in file names: keep only safe characters
      const fixtureId = String(d.fixture_id ?? '').replace(/[^A-Za-z0-9_-]/g, '_') || String(Date.now());

      const templatePath = templatePathFor(d.template);
      let html = fs.readFileSync(templatePath, 'utf8');

      // Decide how the league logo is shown (see LEAGUE_LOGO_DIR comment above)
      const leagueIdMatch = String(d.league_logo || '').match(/leagues\/(\d+)/);
      const leagueId = leagueIdMatch ? Number(leagueIdMatch[1]) : null;
      let leagueLogoSrc = d.league_logo;
      let leagueLogoClass = 'league-logo';
      let leagueLogoIsRemote = true;
      if (leagueId) {
        const localLogo = path.join(LEAGUE_LOGO_DIR, `${leagueId}.png`);
        if (fs.existsSync(localLogo)) {
          leagueLogoSrc = pathToFileURL(localLogo).href;
          leagueLogoClass += ' no-filter';
          leagueLogoIsRemote = false;
        } else if (KEEP_ORIGINAL_COLOR_LEAGUES.has(leagueId)) {
          leagueLogoClass += ' no-filter';
        }
      }

      // Team / league logos: use the local cached copy (downloaded once)
      const [homeLogoSrc, awayLogoSrc, leagueLogoFinal] = await Promise.all([
        localizeImage(d.home_logo),
        localizeImage(d.away_logo),
        leagueLogoIsRemote ? localizeImage(leagueLogoSrc) : leagueLogoSrc,
      ]);
      const tLogos = Date.now();

      // Page name on the image: per request (customers), otherwise the default above.
      // It is HTML-escaped because it comes from outside. Line breaks (\n) are kept.
      let pageName = d.page_name ? escapeHtml(String(d.page_name).slice(0, 80)) : PAGE_NAME;
      // Or the page logo instead of the name: only a small PNG/JPEG/WebP data: URI is accepted, and the
      // <img> tag is built here, so the request can never inject HTML through this field.
      const logoUri = d.page_logo_data_uri;
      if (typeof logoUri === 'string' && logoUri.length <= 3_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logoUri)) {
        pageName = `<img class="brand-logo" src="${logoUri}" alt="" style="max-height:var(--brand-logo-h,90px);max-width:var(--brand-logo-w,300px);width:auto;height:auto;object-fit:contain;">`;
      }
      // Background: either a data: URI (generated default) or a local file path
      const backgroundSrc =
        typeof d.background_data_uri === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(d.background_data_uri)
          ? d.background_data_uri
          : d.background_path ? pathToFileURL(String(d.background_path)).href : '';

      const replacements = {
        '{{BACKGROUND}}': backgroundSrc,
        '{{PAGE_NAME}}': pageName,
        '{{EVENTS_CLASS}}': '',
        '{{TOTAL_EVENTS}}': d.total_events,
        '{{LEAGUE_LOGO}}': leagueLogoFinal,
        '{{HOME_LOGO}}': homeLogoSrc,
        '{{HOME_NAME}}': d.home_team,
        '{{HOME_SCORE}}': d.home_score,
        '{{AWAY_SCORE}}': d.away_score,
        '{{AWAY_LOGO}}': awayLogoSrc,
        '{{AWAY_NAME}}': d.away_team,
        '{{HOME_EVENTS}}': d.home_events_html,
        '{{AWAY_EVENTS}}': d.away_events_html,
      };

      for (const [key, value] of Object.entries(replacements)) {
        html = html.split(key).join(String(value !== undefined && value !== null ? value : ''));
      }

      html = html.replace('class="league-logo"', `class="${leagueLogoClass}"`);

      fs.mkdirSync(RENDERED_DIR, { recursive: true });
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const htmlPath = path.join(RENDERED_DIR, `${fixtureId}.html`);
      const pngPath = path.join(OUTPUT_DIR, `${fixtureId}.png`);
      const jpgPath = path.join(OUTPUT_DIR, `${fixtureId}.jpg`);

      fs.writeFileSync(htmlPath, html, 'utf8');

      // Informational only: how much the background gets enlarged by object-fit: cover.
      // Never blocks rendering; n8n can read background_info.upscale_factor if it wants to react.
      let backgroundInfo = null;
      try {
        if (d.background_path && fs.existsSync(d.background_path)) {
          const bm = await sharp(d.background_path).metadata();
          const upscale = Math.max(FINAL_WIDTH / bm.width, FINAL_HEIGHT / bm.height);
          backgroundInfo = {
            width: bm.width,
            height: bm.height,
            upscale_factor: Math.round(upscale * 100) / 100,
            low_resolution: upscale > 1.0,
          };
          if (backgroundInfo.low_resolution) {
            console.warn(`[fixture ${fixtureId}] Background ${bm.width}x${bm.height} is smaller than needed; enlarged x${backgroundInfo.upscale_factor}`);
          }
        }
      } catch (e) {
        console.warn('Could not read background metadata:', e.message);
      }

      // Render with one automatic retry on a fresh browser: Chromium occasionally stalls on a
      // screenshot (e.g. "Timeout 30000ms exceeded"); restarting it clears that state.
      const MAX_ATTEMPTS = 2;
      let pngBuffer = null; // 2160x2700 screenshot, kept in memory
      let tPageReady = 0;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let page = null;
        try {
          const context = await getContext();
          page = await context.newPage();
          await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 60000 });
          await waitUntilReady(page);
          tPageReady = Date.now();

          // High-resolution intermediate (2160x2700), returned as a buffer (no disk write)
          pngBuffer = await captureHiRes(page, context);
          await page.close().catch(() => {});
          break; // success
        } catch (err) {
          console.warn(`[fixture ${fixtureId}] render attempt ${attempt}/${MAX_ATTEMPTS} failed: ${String(err.message).split('\n')[0]}`);
          if (page) await page.close().catch(() => {});
          // Throw away the (possibly stuck) browser so the next attempt starts clean
          await resetBrowser();
          if (attempt === MAX_ATTEMPTS) throw err;
        }
      }
      const tCaptured = Date.now();

      // Safety check: the intermediate must really be 2160x2700
      const meta = await sharp(pngBuffer).metadata();
      if (meta.width !== HIRES_WIDTH || meta.height !== HIRES_HEIGHT) {
        throw new Error(
          `Unexpected intermediate size ${meta.width}x${meta.height}, expected ${HIRES_WIDTH}x${HIRES_HEIGHT}`
        );
      }

      if (KEEP_PNG) fs.writeFileSync(pngPath, pngBuffer);

      // High-quality downscale 2160x2700 -> 1080x1350, sRGB JPEG for Instagram
      fs.writeFileSync(jpgPath, await makeJpeg(pngBuffer));

      const tDone = Date.now();
      const sec = (ms) => (ms / 1000).toFixed(1);
      console.log(
        `[fixture ${fixtureId}] done in ${sec(tDone - t0)} s ` +
        `(logos ${sec(tLogos - t0)}, page ${sec(tPageReady - tLogos)}, capture ${sec(tCaptured - tPageReady)}, image ${sec(tDone - tCaptured)})`
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        html_path: htmlPath,
        png_path: KEEP_PNG ? pngPath : null,
        jpg_path: jpgPath,
        background_info: backgroundInfo,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, stack: err.stack }));
    }
  });
});

// Only this computer needs to reach the render server.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Render server listening on http://localhost:${PORT}/render`);
  console.log(`Templates folder: ${TEMPLATES_DIR}${fs.existsSync(WARMUP_TEMPLATE_PATH) ? '' : '  (default template NOT FOUND!)'}`);

  // Warm-up: start Chromium, load the web fonts and run one complete dry render now, so the first
  // real render is as fast as all the others (and problems show up now, not during a match).
  (async () => {
    const t = Date.now();
    try {
      const context = await getContext();
      const page = await context.newPage();
      await page.goto(pathToFileURL(WARMUP_TEMPLATE_PATH).href, { waitUntil: 'load', timeout: 60000 });
      await waitUntilReady(page);
      const png = await captureHiRes(page, context);
      await page.close();
      await makeJpeg(png);
      console.log(`Warm-up done in ${((Date.now() - t) / 1000).toFixed(1)} s.`);
    } catch (e) {
      console.warn('Warm-up skipped:', String(e.message).split('\n')[0]);
    }
  })();
});
