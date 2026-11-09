import {checkTemplateHtml,collectUrls} from '../render/template-check.js';
import {tinyApng} from './helpers/image-fixtures';
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTemplateHtml, DEFAULT_CONFIG } from "@/lib/template-builder";
import { sampleMatchFields } from "@/lib/sample-match";

// render/render-server.js is started for real (as its own process) but with a fake Chromium (tests/helpers/fake-playwright.cjs).
// So these tests check everything around the browser: which template is used, what is escaped or refused, the request guard
// and the JPEG that comes out. They do NOT prove that real Chromium draws well: that stays a manual check (npm run render).

const ROOT = resolve(__dirname, "..");
const RENDER_DIR = join(ROOT, "render");
const PROBE_FILE = join(RENDER_DIR, "output", "vitest_server_probe.json");
const PREFIX = "vitest_server_";
const ownsOutput = (name: string) => name.startsWith(PREFIX);
const cleanupOutputs = (dir: string) => {
  if (existsSync(dir)) for (const name of readdirSync(dir)) {
    if (ownsOutput(name)) rmSync(join(dir, name), { force: true });
  }
};

let child: ChildProcess;
let port = 0;
let log = "";

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });

const fileUrl = (p: string) => pathToFileURL(p).href;
const PROBES = [
  "data:image/png;base64,AAAA",
  "https://fonts.googleapis.com/css2?family=Oswald",
  "https://fonts.gstatic.com/s/x.woff2",
  "https://media.example/home.png",
  "https://evil.example/x.png",
  "http://127.0.0.1:3000/api/health",
  fileUrl(join(RENDER_DIR, "rendered", "vitest_server_x.html")),
  fileUrl(join(ROOT, "storage", "backgrounds", "photo.jpg")),
  fileUrl(join(RENDER_DIR, "cache", "logos", "a.png")),
  fileUrl(join(RENDER_DIR, "assets", "leagues", "39.png")),
  fileUrl(join(ROOT, ".env")),
  fileUrl(join(ROOT, "storage", "backgrounds", "..", "..", ".env")),
  fileUrl(join(ROOT, "package.json")),
  "ftp://example.com/x",
  "not a url",
];

async function post(body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", headers:{"x-news-render-secret":"isolated-match-render-test"}, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

const sample = sampleMatchFields();
const base = (id: string, extra: Record<string, unknown> = {}) => ({
  ...sample,
  fixture_id: PREFIX + id,
  page_name: "Final\nWhistle",
  total_events: 3,
  ...extra,
});

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, ["--require", join(__dirname, "helpers", "fake-playwright.cjs"), join(RENDER_DIR, "render-server.js")], {
    cwd: ROOT,
    env: { ...process.env, RENDER_PORT: String(port), NEWS_RENDER_SECRET:"isolated-match-render-test", FW_DOWNLOAD_PROBE:join(RENDER_DIR,"output","vitest_server_downloads.jsonl"), FW_CAPTURE_PROBE:join(RENDER_DIR,"output","vitest_server_capture.jsonl"), FW_PROBE_FILE: PROBE_FILE, FW_PROBE_URLS: JSON.stringify(PROBES) },
  });
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const started = Date.now();
  while (!/Warm-up (done|skipped)/.test(log)) {
    if (child.exitCode !== null) throw new Error("render server stopped early:\n" + log);
    if (Date.now() - started > 40_000) throw new Error("render server did not start:\n" + log);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 60_000);

afterAll(() => {
  child?.kill();
  for (const dir of ["rendered", "output"]) {
    const p = join(RENDER_DIR, dir);
    cleanupOutputs(p);
  }
});

describe("render server (fake Chromium)", () => {
  it("draws each built-in template as a 1080x1350 JPEG", async () => {
    for (const t of ["classic", "panel", "frame", "stripe"]) {
      const r = await post(base(`t_${t}`, { template: t }));
      expect(r.status, t).toBe(200);
      const meta = await sharp(r.json.jpg_path).metadata();
      expect(meta, t).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
      expect(meta.chromaSubsampling, t).toBe('4:4:4');
      expect(meta.icc?.length, t).toBeGreaterThan(0);
      expect(meta.exif, t).toBeUndefined();
      // Fake Chromium supplies a flat image. The exporter must not invent
      // texture/noise in otherwise uniform photographic pixels.
      const rgb=await sharp(r.json.jpg_path).removeAlpha().raw().toBuffer();
      expect(rgb.every((value,index)=>value===rgb[index%3]),t).toBe(true);
      expect(resolve(r.json.jpg_path).startsWith(join(RENDER_DIR, "output")), t).toBe(true);
      const html = readFileSync(r.json.html_path, "utf8");
      expect(html, t).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  it("uses the chosen template, and Classic when the name is unknown or tries to leave the folder", async () => {
    const title = async (template: unknown, id: string) => readFileSync((await post(base(id, { template }))).json.html_path, "utf8").match(/<title>([^<]*)<\/title>/)?.[1];
    const classic = await title("classic", "ta");
    expect(await title("panel", "tb")).toBe("Panel");
    expect(await title("../../package", "tc")).toBe(classic);
    expect(await title("nope", "td")).toBe(classic);
    expect(await title(42, "te")).toBe(classic);
    expect(await title(undefined, "tf")).toBe(classic);
  });

  it("keeps file names safe whatever the fixture id contains", async () => {
    const r = await post(base("x", { fixture_id: "../../evil/../name" }));
    expect(r.status).toBe(200);
    expect(resolve(r.json.jpg_path).startsWith(join(RENDER_DIR, "output"))).toBe(true);
    expect(r.json.jpg_path).not.toContain("..");
    rmSync(r.json.jpg_path, { force: true });
    rmSync(r.json.html_path, { force: true });
  });

  it("escapes the page name", async () => {
    const html = readFileSync((await post(base("esc", { page_name: "<b>x</b>" }))).json.html_path, "utf8");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("shows a logo instead of the page name, but only a real small PNG/JPEG/WebP data: URI", async () => {
    const png = "data:image/png;base64," + (await sharp({ create: { width: 50, height: 20, channels: 4, background: "red" } }).png().toBuffer()).toString("base64");
    const withLogo = readFileSync((await post(base("logo1", { page_logo_data_uri: png }))).json.html_path, "utf8");
    expect(withLogo).toContain('class="brand-logo"');
    expect(withLogo).toContain(png);

    for (const [name, uri] of [
      ["svg", "data:image/svg+xml;base64,AAAA"],
      ["html injection", 'data:image/png;base64,AA"><script>alert(1)</script>'],
      ["a web address", "https://evil.example/logo.png"],
      ["too large", "data:image/png;base64," + "A".repeat(3_100_000)],
    ] as const) {
      const html = readFileSync((await post(base("logo2", { page_logo_data_uri: uri }))).json.html_path, "utf8");
      expect(html, name).not.toContain('class="brand-logo"');
      expect(html, name).not.toContain("<script>alert");
    }
  });

  it("accepts a valid customer template, adds a Content-Security-Policy and installs the request guard", async () => {
    const r = await post(base("custom1", { template: "classic", template_html: buildTemplateHtml(DEFAULT_CONFIG) }));
    expect(r.status).toBe(200);
    const html = readFileSync(r.json.html_path, "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'none'");
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("refuses customer templates that fail the safety check", async () => {
    const good = buildTemplateHtml(DEFAULT_CONFIG);
    for (const [name, html] of [
      ["script", good.replace("</body>", "<script>alert(1)</script></body>")],
      ["local file", good.replace("</body>", '<img src="file:///C:/Windows/win.ini"></body>')],
      ["other website", good.replace("</body>", '<img src="https://google.com/x.png"></body>')],
      ["click handler", good.replace("<body>", '<body onclick="x()">')],
      ["missing score", "<html>{{HOME_NAME}}{{AWAY_NAME}}</html>"],
      ["too long", "x".repeat(250_000)],
    ] as const) {
      const r = await post(base("custom2", { template_html: html }));
      expect(r.status, name).toBe(400);
      expect(r.json.error, name).toMatch(/rejected/i);
    }
  });

  it("the request guard lets through only what a post needs", async () => {
    rmSync(PROBE_FILE, { force: true });
    await post(base("guard", { template_html: buildTemplateHtml(DEFAULT_CONFIG), home_logo: "https://media.example/home.png" }));
    expect(existsSync(PROBE_FILE)).toBe(true);
    const d = JSON.parse(readFileSync(PROBE_FILE, "utf8")) as Record<string, string>;
    const allowed = [PROBES[1], PROBES[2]];
    const blocked = [PROBES[0], PROBES[3], PROBES[4], PROBES[5], PROBES[6], PROBES[7], PROBES[8], PROBES[9], PROBES[10], PROBES[11], PROBES[12], PROBES[13], PROBES[14]];
    for (const u of allowed) expect(d[u], u).toBe("allow");
    for (const u of blocked) expect(d[u], u).toBe("block");
  });

  it("built-in templates keep native caching with CSP and validated input", async () => {
    rmSync(PROBE_FILE, { force: true });
    const result=await post(base("noguard", { template: "frame" }));
    expect(readFileSync(result.json.html_path,"utf8")).toContain("script-src 'none'");
    expect(existsSync(PROBE_FILE)).toBe(false);
  });

  it("stays up after a broken request", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", body: "this is not json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await post(base("after", { template: "classic" }))).status).toBe(200);
  });
});

  it("requires authentication before parsing a Match render request",async()=>{
    const response=await fetch(`http://127.0.0.1:${port}/render`,{method:'POST',body:JSON.stringify(base('auth'))});expect(response.status).toBe(401);
  });
  it("escapes team text and rejects event scripts and private image URLs",async()=>{
    const safe=await post(base('escaped-team',{home_team:'<script>bad()</script>'}));expect(safe.status).toBe(200);const html=readFileSync(safe.json.html_path,'utf8');expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');expect(html).not.toContain('<script>bad()');
    expect((await post(base('bad-events',{home_events_html:'<script>bad()</script>'}))).status).toBe(400);
    expect((await post(base('private-logo',{home_logo:'http://127.0.0.1/private'}))).status).toBe(400);
    expect((await post(base('private-file',{background_data_uri:undefined,background_path:join(ROOT,'package.json')}))).status).toBe(400);
  });

  it("bounds simultaneous render requests and stays healthy after backpressure",async()=>{
    const replies=await Promise.all(Array.from({length:8},(_,i)=>post(base('parallel_'+i))));expect(replies.some(r=>r.status===429)).toBe(true);expect(replies.every(r=>r.status===200||r.status===429)).toBe(true);expect((await post(base('after-busy'))).status).toBe(200);
  });

  it("does not inspect an unused local path when a data background is selected", async () => {
    const response = await post(base('unused-local-path', { background_path: join(ROOT, 'package.json') }));
    expect(response.status).toBe(200);
    expect(response.json.background_info).toBeNull();
  });

  it('localizes every noncanonical HTTPS spelling through the protected downloader',async()=>{
    const probe=join(RENDER_DIR,'output','vitest_server_downloads.jsonl');
    const variants=[' https://images.example.com/r1-space.png','https:images.example.com/r1-slashes.png','https:\\images.example.com/r1-backslash.png','HTTPS://images.example.com/r1-case.png'];
    for(const [index,value] of variants.entries()){
      const response=await post(base('noncanonical_'+index,{home_logo:value}));expect(response.status).toBe(200);
      expect(readFileSync(response.json.html_path,'utf8')).not.toContain('images.example.com');
      const downloads=readFileSync(probe,'utf8').trim().split('\n').map(line=>JSON.parse(line));
      expect(downloads).toContain(new URL(value).href);
    }
  });
  it('rejects oversized background and logo data images before browser work',async()=>{
    const huge='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>');
    expect((await post(base('large-background',{background_data_uri:huge}))).status).toBe(400);
    expect((await post(base('large-logo',{home_logo:huge}))).status).toBe(400);
    const html=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>','<img src="'+huge+'"></body>');
    expect((await post(base('large-embedded',{template_html:html}))).status).toBe(400);
  });
  it.each(['FAIL_MATCH_ONCE','FAIL_MATCH_ALWAYS'])('keeps concurrent News alive during %s',async failure=>{
    const img=(await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
    const news=fetch('http://127.0.0.1:'+port+'/render-news',{method:'POST',headers:{'x-news-render-secret':'isolated-match-render-test'},body:JSON.stringify({job:{layout:'single',quote:'NEWS',author:'AUTHOR',caption:'',pos:{b:[50,50,1],c:[50,30,1]}},background:img,circle:null})});
    const match=post(base('retry_'+failure,{home_team:failure}));
    const [n,m]=await Promise.all([news,match]);expect(m.status).toBe(failure==='FAIL_MATCH_ONCE'?200:500);expect(n.status).toBe(200);
    const output=await n.json();expect((await sharp(output.jpg_path).metadata()).width).toBe(1080);rmSync(output.jpg_path);
  });
  it('isolates HTML and JPEG paths for overlapping requests with the same fixture ID',async()=>{
    const [a,b]=await Promise.all([post(base('same_id',{home_team:'CONCURRENT_ALPHA'})),post(base('same_id',{home_team:'CONCURRENT_BETA'}))]);
    expect(a.status).toBe(200);expect(b.status).toBe(200);expect(a.json.html_path).not.toBe(b.json.html_path);expect(a.json.jpg_path).not.toBe(b.json.jpg_path);
    expect(readFileSync(a.json.html_path,'utf8')).toContain('CONCURRENT_ALPHA');expect(readFileSync(b.json.html_path,'utf8')).toContain('CONCURRENT_BETA');
    expect(readFileSync(a.json.jpg_path).equals(readFileSync(b.json.jpg_path))).toBe(false);
  });

 it('rejects CSS escape, nested SVG and APNG requests at the HTTP boundary',async()=>{
  const escaped=buildTemplateHtml(DEFAULT_CONFIG).replace('</style>',String.raw`.x{background-image:u\72l("data:image/png;base64,AAAA")}</style>`);
  expect((await post(base('escaped-css-container',{template_html:escaped}))).status).toBe(400);
  const nested='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="data:image/png;base64,AAAA"/></svg>').toString('base64');
  expect((await post(base('svg-container',{background_data_uri:nested}))).status).toBe(400);
  const animated='data:image/png;base64,'+tinyApng().toString('base64');
  expect((await post(base('apng-background',{background_data_uri:animated}))).status).toBe(400);
  expect((await post(base('apng-logo',{home_logo:animated}))).status).toBe(400);
 });

 it.each(['u&#114;l','u&#x72l','url&lpar;'])('rejects HTML-encoded CSS resources before rendering: %s',name=>{
  const css=name==='url&lpar;'?name+'data:image/png;base64,AAAA&rpar;':name+'(data:image/png;base64,AAAA)';
  const html=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>','<div style="background-image:'+css+'"></div></body>');
  return post(base('encoded-css-resource',{template_html:html})).then(response=>expect(response.status).toBe(400));
 });

 it('rejects Astra SVG style boundary attack and non-image MIME aliases',async()=>{
  const attack='<svg><style title="> </style>">.x{background-image:u&#114;l(data:image/png;base64,AAAA)}</style></svg>';
  const html=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>',attack+'</body>');
  expect((await post(base('svg-quoted-boundary',{template_html:html}))).status).toBe(400);
  const png=(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
  const alias=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>','<img src="data:font/woff;base64,'+png+'"></body>');
  expect((await post(base('font-mime-image',{template_html:alias}))).status).toBe(400);
 });

it('collects resources behind CSS decoys before metadata checks at the HTTP boundary',async()=>{
 const huge='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>').toString('base64');
 const cases=[
  '<style>/* url(\'# */ .x{background-image:url('+huge+')} /* \') */</style>',
  '<div title="url(\'#"></div><div style="background-image:url('+huge+')"></div><div title="\')"></div>',
  '<style>.x{content:"url(\'#";background:url('+huge+');--text:"\')"}</style>',
 ];
 for(const [index,extra] of cases.entries()){
  const html=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>',extra+'</body>');
  expect(checkTemplateHtml(html).ok).toBe(true);expect(collectUrls(html)).toContain(huge);
  const response=await post(base('css_decoy_'+index,{template_html:html}));
  expect(response.status).toBe(400);
  expect(response.json.error).toBe('Render request rejected');
 }
});
it('rejects quoted-angle-bracket SVG animation before browser work',async()=>{
 const png=(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 const extra='<svg><image id="probe"/><set title=">" attributeName="href" to="data:image/png;base64,'+png+'" href="#probe"/></svg>';
 const html=buildTemplateHtml(DEFAULT_CONFIG).replace('</body>',extra+'</body>');
 const response=await post(base('svg_animation_quoted',{template_html:html}));
 expect(response.status).toBe(400);expect(response.json.error).toMatch(/rejected/i);
});

// The stored source is safe-looking; only the fully expanded document exposes the resource.
it('validates resources assembled after placeholder substitution before Chromium',async()=>{
 const oversized='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>');
 const html='<html><head></head><body>{{HOME_NAME}}{{AWAY_NAME}}{{HOME_SCORE}}{{AWAY_SCORE}}<div style="background:u{{EVENTS_CLASS}}rl('+oversized+')"></div></body></html>';
 const result=await post(base('final_expansion',{template_html:html}));expect(result.status).toBe(400);
});

it('deduplicates concurrent canonical logo misses without caching failures',async()=>{
 const probe=join(RENDER_DIR,'output','vitest_server_downloads.jsonl'),url='https://images.example.com/singleflight-regression.png';
 const count=()=>existsSync(probe)?readFileSync(probe,'utf8').trim().split('\n').filter(line=>line&&JSON.parse(line)===url).length:0;
 const start=count();const [a,b]=await Promise.all([post(base('flight_a',{home_logo:url,away_logo:url})),post(base('flight_b',{home_logo:'HTTPS://images.example.com/singleflight-regression.png',away_logo:url}))]);
 expect(a.status).toBe(200);expect(b.status).toBe(200);expect(count()-start).toBe(1);expect((await post(base('flight_retry',{home_logo:url}))).status).toBe(200);expect(count()-start).toBe(2);
});
it('adds unique request IDs and authenticates bounded route metrics without changing News protocol',async()=>{
 const url='http://127.0.0.1:'+port;
 expect((await fetch(url+'/render-health')).status).toBe(401);
 const response=await fetch(url+'/render',{method:'POST',headers:{'x-news-render-secret':'isolated-match-render-test'},body:JSON.stringify(base('request_id'))});expect(response.status).toBe(200);expect(response.headers.get('x-request-id')).toMatch(/^[a-f\d-]{36}$/);
 const rejected=await fetch(url+'/render',{method:'POST',body:'{}'});expect(rejected.status).toBe(401);expect(rejected.headers.get('x-request-id')).not.toBe(response.headers.get('x-request-id'));
 const health=await fetch(url+'/render-health',{headers:{'x-news-render-secret':'isolated-match-render-test'}});const stats=await health.json();expect(stats.window).toBe(200);expect(stats.routes.match.succeeded).toBeGreaterThan(0);expect(stats.routes.match.rejected).toBeGreaterThan(0);expect(stats.routes.news.succeeded).toBeGreaterThan(0);expect(stats.routes.match.samples).toBeLessThanOrEqual(200);expect(JSON.stringify(stats)).not.toContain('isolated-match-render-test');
 const protocol=await fetch(url+'/news-health',{headers:{'x-news-render-secret':'isolated-match-render-test'}});expect(await protocol.json()).toEqual({service:'final-whistle-news',protocolVersion:2});
});
it('keeps fast capture after one failure and falls back permanently only after three consecutive failures',async()=>{
 const probe=join(RENDER_DIR,'output','vitest_server_capture.jsonl');writeFileSync(probe,'');
 expect((await post(base('fast_one',{home_team:'FAST_CAPTURE_ALWAYS'}))).status).toBe(200);
 expect((await post(base('fast_recovered'))).status).toBe(200);
 let events=readFileSync(probe,'utf8').trim().split('\n').map(line=>JSON.parse(line));expect(events.map(e=>e.standard)).toEqual([false,true,false]);
 writeFileSync(probe,'');for(let i=0;i<3;i++)expect((await post(base('fast_fail_'+i,{home_team:'FAST_CAPTURE_ALWAYS'}))).status).toBe(200);expect((await post(base('fast_disabled'))).status).toBe(200);
 events=readFileSync(probe,'utf8').trim().split('\n').map(line=>JSON.parse(line));expect(events.filter(e=>!e.standard)).toHaveLength(3);expect(events.filter(e=>e.standard)).toHaveLength(4);
});

it("cleanup removes only owned files and preserves lifecycle and unrelated outputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "fw-render-cleanup-"));
  const owned = ["vitest_server_t_classic_uuid.jpg", "vitest_server_probe.json"];
  const retained = ["vitest_lifecycle_drain_a_uuid.jpg", "news_1234.jpg", "customer-post.jpg"];
  try {
    for (const name of [...owned, ...retained]) writeFileSync(join(dir, name), name);
    cleanupOutputs(dir);
    for (const name of owned) expect(existsSync(join(dir, name)), name).toBe(false);
    for (const name of retained) expect(readFileSync(join(dir, name), "utf8"), name).toBe(name);
    cleanupOutputs(dir); // Idempotent cleanup must still leave foreign output intact.
    expect(readdirSync(dir).sort()).toEqual([...retained].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true }); // Only this test's mkdtemp directory.
  }
});
