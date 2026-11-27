// render-server.js
// A small, persistent local HTTP server. The worker (scripts/worker.mjs) and the dashboard call it
// (POST /render) to draw a result post with Chromium and return a native PNG plus compatibility JPEG.
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
//   -> save the native lossless PNG; Sharp also supplies a legacy 1080x1350 JPEG, quality 97
//
// Speed notes (none of these change the picture):
//   * one long-lived Chromium + one shared browser context, warmed up at start-up
//   * team / league logos are cached on disk, so a render needs no network for them
//   * the 2160x2700 capture is saved directly without resampling or grain
//   * the intermediate PNG is encoded with Chromium's fast encoder (lossless, same pixels)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leagueAccents } = require('./league-accents.js');
const { pathToFileURL, fileURLToPath } = require('url');
const { leagueLogoSize } = require('./league-logo-sizing.js');
const { competitionLabel, applyMatchPresentation, fitMatchComposition } = require('./match-presentation.js');
const {alignBranding}=require('./branding-position.js');
const { checkTemplateHtml, withCsp } = require('./template-check.js');
const {expandPlaceholders}=require('./final-document.js');
const {prepareCustomDocument}=require('./custom-resources.js');
const { chromium } = require('playwright');
const sharp = require('sharp');
const security = require('./security.js');
const {createMetrics,withPageDeadline,createDrainTracker}=require('./operations.js');
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
const JPEG_QUALITY = 97;
// Preserve photographic pixels and typography. Quality comparisons found no
// benefit sufficient to justify adding noise across the entire Match image.
const GRAIN_SIGMA = 0;

// Native lossless PNG is the primary Match deliverable. Keep the existing JPEG
// response as a compatibility export for older API clients; bots prefer PNG.
const KEEP_PNG = true;

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

// ---------------------------------------------------------------------------------------------
// Logo cache
// ---------------------------------------------------------------------------------------------

// <logo-cache>
const { localizeImage } = require('./assets-runtime/logo-cache.js')({ ROOT, ALLOWED_FILE_DIRS, EMPTY_IMAGE, security });
// </logo-cache>

// ---------------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------------

const { getBrowser, getContext, resetBrowser } = require('./runtime/browser.js')({ chromium });

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const { captureHiRes, makeJpeg, waitUntilReady } = require('./runtime/image-export.js')({
  sharp, FINAL_WIDTH, FINAL_HEIGHT, HIRES_WIDTH, HIRES_HEIGHT, JPEG_QUALITY, GRAIN_SIGMA
});

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


const handleNewsRequest = require('./news/http-handler.js')({ renderNews });

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
  const controller=new AbortController();
  const cancel=()=>{if(!res.writableFinished)controller.abort();};
  req.once('aborted',cancel);res.once('close',cancel);
  const deadline=setTimeout(()=>controller.abort(),110000);deadline.unref?.();
  let release;
  try{
    release=await renderGate.acquire();
    controller.signal.throwIfAborted();
    if(req.destroyed)return;
    if(req.url==='/render-news'){await handleNewsRequest(req,res,controller.signal);return;}
    const body=await security.readBody(req,45*1024*1024);
    const d=security.validateMatch(JSON.parse(body));
    if(d.output_format!==undefined&&!['png','jpeg','both'].includes(d.output_format))throw Object.assign(new Error('Invalid output format'),{statusCode:400});
    const pngOnly=d.output_format==='png';
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
      const leagueId = Number.isSafeInteger(d.league_id) && d.league_id > 0 ? d.league_id : leagueIdMatch ? Number(leagueIdMatch[1]) : null;
      const leagueLabel = !isCustom ? competitionLabel(leagueId) : null;
      let leagueLogoSrc = d.league_logo;
      let leagueLogoClass = 'league-logo';
      let leagueLogoIsRemote = true;
      if (leagueId) {
        const symbolLogo = path.join(LEAGUE_LOGO_DIR, 'symbols', `${leagueId}.png`);
        const useSymbol = !isCustom && fs.existsSync(symbolLogo);
        const localLogo = useSymbol ? symbolLogo : path.join(LEAGUE_LOGO_DIR, `${leagueId}.png`);
        if (fs.existsSync(localLogo)) {
          leagueLogoSrc = pathToFileURL(localLogo).href;
          if (!useSymbol || KEEP_ORIGINAL_COLOR_LEAGUES.has(leagueId)) leagueLogoClass += ' no-filter';
          leagueLogoIsRemote = false;
        } else if (KEEP_ORIGINAL_COLOR_LEAGUES.has(leagueId)) {
          leagueLogoClass += ' no-filter';
        }
      }

      // Team / league logos: use the local cached copy (downloaded once)
      const [homeLogoSrc, awayLogoSrc, leagueLogoFinal] = await Promise.all([
        localizeImage(d.home_logo),
        localizeImage(d.away_logo),
        leagueLabel ? null : leagueLogoIsRemote ? localizeImage(leagueLogoSrc) : leagueLogoSrc,
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

      const accents = leagueAccents(d.league_id, d.league_logo);
      const replacements = {
        '{{BACKGROUND}}': escapeHtml(backgroundSrc),
        '{{PAGE_NAME}}': pageName,
        '{{EVENTS_CLASS}}': '',
        '{{TOTAL_EVENTS}}': d.total_events,
        '{{LEAGUE_LINE_LEFT}}': accents.left,
        '{{LEAGUE_LINE_RIGHT}}': accents.right,
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

      const leagueSize = !isCustom ? leagueLogoSize(leagueId) : null;
      const leagueSizeStyle = leagueSize ? ` style="width:${leagueSize.width}px;height:${leagueSize.height}px"` : '';
      html = html.replace('class="league-logo"', `class="${leagueLogoClass}"${leagueSizeStyle}`);
      if (!isCustom) html = applyMatchPresentation(html, {leagueId, template:d.template || DEFAULT_TEMPLATE});

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
            if (!isCustom) await fitMatchComposition(page, d.template || DEFAULT_TEMPLATE);
            await alignBranding(page);
            tPageReady = Date.now();

            // High-resolution intermediate (2160x2700), returned as a buffer (no disk write)
            return captureHiRes(page, context);
          },undefined,controller.signal);
          await page.close().catch(() => {});
          break; // success
        } catch (err) {
          if(controller.signal.aborted)throw err;
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

      controller.signal.throwIfAborted();
      if (KEEP_PNG) fs.writeFileSync(pngPath, pngBuffer);

      // High-quality downscale 2160x2700 -> 1080x1350, sRGB JPEG for Instagram
      if(!pngOnly)fs.writeFileSync(jpgPath, await makeJpeg(pngBuffer));

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
        jpg_path: pngOnly ? null : jpgPath,
        background_info: backgroundInfo,
      }));
  }catch(err){
    if(res.destroyed)return;
    const status=controller.signal.aborted?504:err.statusCode??(err instanceof SyntaxError?400:500);
    res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:status<500?'Render request rejected':'Rendering failed'}));
  }finally{clearTimeout(deadline);req.removeListener('aborted',cancel);res.removeListener('close',cancel);release?.();complete();}
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
    let page,releaseWarmup;
    try {
      releaseWarmup=await renderGate.acquire();
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
    }finally{if(page)await page.close().catch(()=>{});releaseWarmup?.();}
  })();
});
