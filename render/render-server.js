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
const { pathToFileURL, fileURLToPath } = require('url');
const { checkTemplateHtml, withCsp } = require('./template-check.js');
const {expandPlaceholders}=require('./final-document.js');
const {prepareCustomDocument}=require('./custom-resources.js');
const { chromium } = require('playwright');
const sharp = require('sharp');
const security = require('./security.js');
const {createSingleFlight,createMetrics,withPageDeadline,createCapturePolicy,createDrainTracker}=require('./operations.js');
const EMPTY_IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

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

// ---------------------------------------------------------------------------
// Customer-made templates ("template_html" in the request) are untrusted. Layers of protection:
//   1. checkTemplateHtml (template-check.js) refuses scripts, event attributes, frames, forms and any URL that is
//      not a {{placeholder}}, a data: picture or Google Fonts. It runs again here, never trusting the request.
//   2. Final HTML5/CSS parsing follows all expansion; immutable image bytes form a closed manifest.
//      Its CSP denies direct data/file/remote images; the route serves only manifest images + provider fonts.
//   3. guardPage serves manifest images, the exact document and fixed-provider styles/fonts only.
//      No custom page can read logo/background directories directly or load direct data images.
// Built-in templates (render/templates) are our own files and are drawn as before.
// ---------------------------------------------------------------------------
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const ALLOWED_FILE_DIRS = [
  RENDERED_DIR,
  path.join(ROOT, 'cache', 'logos'),
  path.join(ROOT, 'assets', 'leagues'),
  path.join(ROOT, '..', 'storage', 'backgrounds'),
].map((p) => norm(path.resolve(p)));

function requestAllowed(urlStr, remoteOk, htmlPath) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return false; }
  if (u.protocol === 'data:' || u.protocol === 'about:') return true;
  if (u.protocol === 'file:') {
    let p;
    try { p = norm(path.resolve(fileURLToPath(u))); } catch (e) { return false; }
    if(htmlPath && p===norm(path.resolve(htmlPath))) return true;
    try { security.insideFile(p,ALLOWED_FILE_DIRS.filter(dir=>dir!==norm(path.resolve(RENDERED_DIR))));return true; }catch{return false;}
  }
  if (u.protocol === 'https:' && (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com')) return true;
  return false; // Remote images are localized by the pinned downloader, never loaded by Chromium.
}

const fontCache=new Map();
const fontUrl=url=>/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);
const fontKey=request=>request.url()+'|'+(request.headers?.()['user-agent']??'');
function cacheFont(key,value){if(fontCache.size>=64&&!fontCache.has(key))fontCache.delete(fontCache.keys().next().value);fontCache.set(key,value);}
async function guardPage(page, remoteOk, htmlPath, manifest) {
  // Only the fixed Google Fonts hosts use Chromium's trusted provider path.
  // Capture browser responses once, then fulfill from memory on warm renders.
  page.on?.('response',async response=>{
    if(!fontUrl(response.url())||response.status()!==200||fontCache.get(fontKey(response.request()))?.body)return;
    try{const body=await response.body();if(body.length<=4*1024*1024)cacheFont(fontKey(response.request()),{body,contentType:response.headers()['content-type']??'application/octet-stream'});}catch{}
  });
  page.on?.('requestfailed',request=>{if(fontUrl(request.url()))cacheFont(fontKey(request),{failed:true,until:Date.now()+30000});});
  await page.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(manifest){
      const asset=manifest.get(url);
      if(asset)return route.fulfill({status:200,headers:{'content-type':asset.contentType,'access-control-allow-origin':'*'},body:asset.body});
      const type=request.resourceType?.();
      const provider=fontUrl(url)&&((new URL(url).hostname==='fonts.googleapis.com'&&type==='stylesheet')||(new URL(url).hostname==='fonts.gstatic.com'&&type==='font'));
      if(!(url===pathToFileURL(htmlPath).href&&type==='document')&&!provider)return route.abort();
    }
    if(!requestAllowed(url,remoteOk,htmlPath))return route.abort();
    if(fontUrl(url)){
      const entry=fontCache.get(fontKey(request));
      if(entry?.body)return route.fulfill({status:200,headers:{'content-type':entry.contentType,'access-control-allow-origin':'*'},body:entry.body});
      if(entry?.failed&&entry.until>Date.now())return route.abort();
    }
    return route.continue();
  });
}

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
      if (st.size<=5*1024*1024 && (allowStale || Date.now() - st.mtimeMs < LOGO_CACHE_MAX_AGE_MS)) {security.insideFile(p,[LOGO_CACHE_DIR]);return p;}
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

const logoFlights=createSingleFlight(16);

// Canonicalize first: every HTTP(S) image goes through the pinned downloader.
async function localizeImage(url) {
  url=security.imageSource(url,{fileDirectories:ALLOWED_FILE_DIRS});
  if (!/^https?:/.test(url)) return url;
  const key = crypto.createHash('sha1').update(String(url)).digest('hex');
  const toFileUrl = (p) => pathToFileURL(p).href;
  return logoFlights.run(key,async()=>{
    try {
      const fresh = findCachedLogo(key, false);
      if (fresh) return toFileUrl(fresh);

      fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });
      const resource = await security.downloadPublicResource(String(url), {timeoutMs:LOGO_DOWNLOAD_TIMEOUT_MS,maxBytes:5*1024*1024});
      const buf = resource.body;
      if (buf.length < 64) throw new Error('response too small to be an image');

      if(!resource.contentType.startsWith('image/'))throw new Error('Invalid image response');
      await security.validateMatchImage(buf);
      const ext = extFromContentType(resource.contentType, url);
      const finalPath = path.join(LOGO_CACHE_DIR, `${key}.${ext}`);
      const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, finalPath);
      return toFileUrl(finalPath);
    } catch (e) {
      // Download failed: an expired cached copy is still better than a broken image
      const stale = findCachedLogo(key, true);
      if (stale) {
        console.warn("Logo download unavailable; using the cached image.");
        return toFileUrl(stale);
      }
      console.warn("Logo download unavailable; using a transparent fallback.");
      return EMPTY_IMAGE;
    }
  });
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

// Explicit shutdown only. Request failures must never close other in-flight contexts.
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
const capturePolicy=createCapturePolicy();
async function captureHiRes(page, context) {
  if (capturePolicy.enabled) {
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
      if (meta.width === HIRES_WIDTH && meta.height === HIRES_HEIGHT) {capturePolicy.success();return buf;}
      if(capturePolicy.failure())console.warn('Fast capture disabled after three qualifying failures.');
      console.warn(`Fast capture returned ${meta.width}x${meta.height}; using the standard screenshot instead.`);
    } catch (e) {
      // A stall retries on a new page; it never disables CDP or closes the shared browser.
      if (/timed out/.test(String(e.message))) throw e;
      if(capturePolicy.failure(e))console.warn('Fast capture disabled after three qualifying failures.');
      console.warn('Fast capture not available, using the standard screenshot:', String(e.message).split('\n')[0]);
    } finally {
      if (client) await client.detach().catch(() => {});
    }
  }
  return page.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 120000 });
}

// 2160x2700 PNG buffer -> 1080x1350 sRGB JPEG buffer (Lanczos3 downscale, light grain)
async function makeJpeg(pngBuffer, { grain = true } = {}) {
  let img = sharp(pngBuffer)
    .flatten({ background: '#000000' })          // no alpha channel in the JPEG
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb');
  if (grain && GRAIN_SIGMA > 0) {
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

const renderNews = require("./news-renderer.js")({
  getBrowser, 
  captureHiRes, 
  makeJpeg, 
  sharp, 
  outputDir: OUTPUT_DIR
});


async function handleNewsRequest(req, res) {
  const secret = process.env.NEWS_RENDER_SECRET;
  const supplied = req.headers["x-news-render-secret"];

  const expectedBuffer = Buffer.from(secret || "");
  const suppliedBuffer = Buffer.from(
    typeof supplied === "string" ? supplied : ""
  );

  if (
    !secret ||
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  if (req.method === 'GET' && req.url === '/news-health') {
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({service:'final-whistle-news',protocolVersion:2}));
    return;
  }

  const MAX_BYTES = 45 * 1024 * 1024;
  let chunks = [];
  let total = 0;

  try {
    for await (const chunk of req) {
      total += chunk.length;

      if (total > MAX_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request too large" }));
        return;
      }

      chunks.push(chunk);
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    
    const job = payload.job;

    if (
      !job ||
      typeof job !== "object" ||
      Array.isArray(job) ||
      !["single", "left", "right", "breaking"].includes(job.layout) ||
      typeof job.quote !== "string" ||
      typeof job.author !== "string" ||
      typeof job.caption !== "string" ||
      job.quote.length > 4096 ||
      job.author.length > 4096 ||
      job.caption.length > 4096 ||
      !job.pos ||
      typeof job.pos !== "object"
    ) {
      throw new Error("Invalid News job");
    }

    function validPosition(value) {
      return (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((n) => typeof n === "number" && Number.isFinite(n))
      );
    }

    if (!validPosition(job.pos.b) || !validPosition(job.pos.c)) {
      throw new Error("Invalid image position");
    }

    function decodeImage(value, required) {
      if (value == null && !required) return null;

      if (
        typeof value !== "string" ||
        !value.length ||
        value.length > 30 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
        value.length % 4 !== 0
      ) {
        throw new Error("Invalid image data");
      }

      const buffer = Buffer.from(value, "base64");

      if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
        throw new Error("Invalid image size");
      }

      return buffer;
    }

    const background = decodeImage(payload.background, true);
    const circle = decodeImage(payload.circle, false);

    const result = await renderNews(job, background, circle);


    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("[news render]", error.message);

    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "News rendering failed" }));
  }
}

const renderGate=security.createRenderGate();
const metrics=createMetrics();
const draining=createDrainTracker();
let warmUpPromise=Promise.resolve();
const server = http.createServer(async (req,res) => {
  const requestId=crypto.randomUUID();
  res.setHeader('X-Request-ID',requestId);
  if(req.method==='GET'&&req.url==='/render-health'){
    if(!security.authorized(req.headers)){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'Unauthorized'}));return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({service:'final-whistle-renderer',draining:draining.draining,inflight:draining.active,...metrics.snapshot()}));return;
  }
  if(req.method==='GET' && req.url==='/news-health')return handleNewsRequest(req,res);
  if(req.method!=='POST'||!['/render','/render-news'].includes(req.url)){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'Not found'}));return;}
  const kind=req.url==='/render-news'?'news':'match';
  const started=performance.now();let recorded=false;
  const record=cancelled=>{if(recorded)return;recorded=true;const elapsed=performance.now()-started;metrics.record(kind,res.statusCode,elapsed,cancelled);console.log(`[render ${requestId}] ${kind} status=${res.statusCode} elapsed_ms=${Math.round(elapsed)}${cancelled?' cancelled':''}`);};
  res.once('finish',()=>record(false));res.once('close',()=>record(!res.writableFinished));
  if(!security.authorized(req.headers)){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'Unauthorized'}));return;}
  const complete=draining.begin();
  if(!complete){res.writeHead(503,{'content-type':'application/json','retry-after':'5'});res.end(JSON.stringify({error:'Renderer is draining'}));return;}
  let release;
  try{
    release=await renderGate.acquire();
    if(req.destroyed)return;
    if(req.url==='/render-news'){await handleNewsRequest(req,res);return;}
    const body=await security.readBody(req,45*1024*1024);
    const d=security.validateMatch(JSON.parse(body));
      const t0 = Date.now();

      // fixture_id ends up in file names: keep only safe characters
      const fixtureId = String(d.fixture_id ?? '').replace(/[^A-Za-z0-9_-]/g, '_') || String(Date.now());

      let html;
      const isCustom = typeof d.template_html === 'string' && d.template_html !== '';
      if (isCustom) {
        const check = checkTemplateHtml(d.template_html);
        if (!check.ok) throw Object.assign(new Error('Custom template rejected'),{statusCode:400});
        html = d.template_html;
      } else {
        html = withCsp(fs.readFileSync(templatePathFor(d.template), 'utf8'));
      }
      // Remote logos are localized before either built-in or custom templates are rendered.
      const remoteOk = new Set(
        [d.home_logo, d.away_logo, d.league_logo].filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
      );

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
        await security.validateMatchImageSource(logoUri);
        pageName = `<img class="brand-logo" src="${logoUri}" alt="" style="max-height:var(--brand-logo-h,90px);max-width:var(--brand-logo-w,300px);width:auto;height:auto;object-fit:contain;">`;
      }
      // Background: either a data: URI (generated default) or a local file path
      const backgroundSrc =
        typeof d.background_data_uri === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(d.background_data_uri)
          ? security.imageSource(d.background_data_uri)
          : d.background_path ? pathToFileURL(security.insideFile(String(d.background_path),[path.join(ROOT,'..','storage','backgrounds')])).href : '';

      const [backgroundMetadata] = await Promise.all(
        [backgroundSrc,homeLogoSrc,awayLogoSrc,leagueLogoFinal].map(source=>security.validateMatchImageSource(source,{fileDirectories:ALLOWED_FILE_DIRS}))
      );

      const replacements = {
        '{{BACKGROUND}}': escapeHtml(backgroundSrc),
        '{{PAGE_NAME}}': pageName,
        '{{EVENTS_CLASS}}': '',
        '{{TOTAL_EVENTS}}': d.total_events,
        '{{LEAGUE_LOGO}}': escapeHtml(leagueLogoFinal??''),
        '{{HOME_LOGO}}': escapeHtml(homeLogoSrc??''),
        '{{HOME_NAME}}': escapeHtml(d.home_team??''),
        '{{HOME_SCORE}}': d.home_score,
        '{{AWAY_SCORE}}': d.away_score,
        '{{AWAY_LOGO}}': escapeHtml(awayLogoSrc??''),
        '{{AWAY_NAME}}': escapeHtml(d.away_team??''),
        '{{HOME_EVENTS}}': d.home_events_html,
        '{{AWAY_EVENTS}}': d.away_events_html,
      };

      html = expandPlaceholders(html,replacements);

      html = html.replace('class="league-logo"', `class="${leagueLogoClass}"`);

      // Last transformation: canonical checked bytes + immutable image manifest.
      // Never interpolate or otherwise mutate HTML after this boundary.
      let customManifest;
      if(isCustom){const prepared=await prepareCustomDocument(html,ALLOWED_FILE_DIRS.filter(dir=>dir!==norm(path.resolve(RENDERED_DIR))));html=prepared.html;customManifest=prepared.manifest;}

      fs.mkdirSync(RENDERED_DIR, { recursive: true });
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const requestId = `${fixtureId.slice(0,100)}_${crypto.randomUUID()}`;
      const htmlPath = path.join(RENDERED_DIR, `${requestId}.html`);
      const pngPath = path.join(OUTPUT_DIR, `${requestId}.png`);
      const jpgPath = path.join(OUTPUT_DIR, `${requestId}.jpg`);

      fs.writeFileSync(htmlPath, html, 'utf8');

      // Informational only: how much the background gets enlarged by object-fit: cover.
      // Never blocks rendering; n8n can read background_info.upscale_factor if it wants to react.
      let backgroundInfo = null;
      try {
        if (backgroundSrc.startsWith('file:')) {
          const bm = backgroundMetadata;
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

      // Retry on a new page without closing the browser serving concurrent News/Match jobs.
      // A real browser disconnect already invalidates the shared browser/context in getBrowser.
      const MAX_ATTEMPTS = 2;
      let pngBuffer = null; // 2160x2700 screenshot, kept in memory
      let tPageReady = 0;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let page = null;
        try {
          const context = await getContext();
          page = await context.newPage();
          // Built-ins have a closed, validated data-only payload and CSP.
          // Keep native browser caching; untrusted customer CSS additionally needs interception.
          pngBuffer = await withPageDeadline(page,async()=>{
            if(isCustom) await guardPage(page, remoteOk, htmlPath, customManifest);
            await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 60000 });
            await waitUntilReady(page);
            tPageReady = Date.now();

            // High-resolution intermediate (2160x2700), returned as a buffer (no disk write)
            return captureHiRes(page, context);
          });
          await page.close().catch(() => {});
          break; // success
        } catch (err) {
          console.warn(`[fixture ${fixtureId}] render attempt ${attempt}/${MAX_ATTEMPTS} failed: ${String(err.message).split('\n')[0]}`);
          if (page) await page.close().catch(() => {});
          // Only this request's page is closed; never reset a healthy shared browser here.
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
  }catch(err){
    const status=err.statusCode??(err instanceof SyntaxError?400:500);
    res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:status<500?'Render request rejected':'Rendering failed'}));
  }finally{release?.();complete();}
});
server.requestTimeout=30000;
server.headersTimeout=10000;

// Stop admission first; finish already admitted Match/News work and warm-up before closing Chromium.
// No forced timeout closes active jobs. A supervisor must allow time for this drain.
let shutdownPromise;
function drainAndClose(){
  if(shutdownPromise)return shutdownPromise;
  const idle=draining.drain();
  console.log('Renderer draining; waiting for admitted work and warm-up.');
  const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  server.closeIdleConnections?.();
  shutdownPromise=(async()=>{
    // Observe all promises immediately, including listener-close errors during startup.
    await Promise.all([idle.then(()=>server.closeIdleConnections?.()),warmUpPromise,closed]);
    await resetBrowser();
    console.log('Renderer drain complete.');
  })();
  return shutdownPromise;
}
const shutdown=()=>{drainAndClose().then(()=>process.exit(0),()=>{console.error('Renderer drain failed.');process.exitCode=1;});};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
// Only disposable test/preview children expose this private IPC path; no HTTP shutdown endpoint.
if(process.env.FW_RENDER_CHILD==='1'&&process.send){
  process.on('message',message=>{if(message==='shutdown')shutdown();});
}

// Only this computer needs to reach the render server.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Render server listening on http://localhost:${PORT}/render`);
  console.log(`Templates folder: ${TEMPLATES_DIR}${fs.existsSync(WARMUP_TEMPLATE_PATH) ? '' : '  (default template NOT FOUND!)'}`);

  // Warm-up: start Chromium, load the web fonts and run one complete dry render now, so the first
  // real render is as fast as all the others (and problems show up now, not during a match).
  if(draining.draining)return;
  warmUpPromise=(async () => {
    const t = Date.now();
    let page;
    try {
      const context = await getContext();
      page = await context.newPage();
      const png=await withPageDeadline(page,async()=>{
        await page.goto(pathToFileURL(WARMUP_TEMPLATE_PATH).href, { waitUntil: 'load', timeout: 60000 });
        await waitUntilReady(page);
        return captureHiRes(page, context);
      });
      await makeJpeg(png);
      console.log(`Warm-up done in ${((Date.now() - t) / 1000).toFixed(1)} s.`);
    } catch (e) {
      console.warn('Warm-up skipped:', String(e.message).split('\n')[0]);
    }finally{if(page)await page.close().catch(()=>{});}
  })();
});
