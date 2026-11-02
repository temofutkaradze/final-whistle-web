import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
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
const PROBE_FILE = join(RENDER_DIR, "output", "vitest-probe.json");
const PREFIX = "vitest_";

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
  fileUrl(join(RENDER_DIR, "rendered", "vitest_x.html")),
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
  const res = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

const sample = sampleMatchFields();
const base = (id: string, extra: Record<string, unknown> = {}) => ({
  ...sample,
  fixture_id: PREFIX + id,
  page_name: "Final\nWhistle",
  total_events: 3,
  home_logo: "data:image/svg+xml;utf8,x",
  away_logo: "data:image/svg+xml;utf8,y",
  league_logo: "data:image/svg+xml;utf8,z",
  ...extra,
});

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, ["--require", join(__dirname, "helpers", "fake-playwright.cjs"), join(RENDER_DIR, "render-server.js")], {
    cwd: ROOT,
    env: { ...process.env, RENDER_PORT: String(port), FW_PROBE_FILE: PROBE_FILE, FW_PROBE_URLS: JSON.stringify(PROBES) },
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
    if (existsSync(p)) for (const f of readdirSync(p)) if (f.startsWith(PREFIX) || f === "vitest-probe.json") rmSync(join(p, f), { force: true });
  }
});

describe("render server (fake Chromium)", () => {
  it("draws each built-in template as a 1080x1350 JPEG", async () => {
    for (const t of ["classic", "panel", "frame", "stripe"]) {
      const r = await post(base(`t_${t}`, { template: t }));
      expect(r.status, t).toBe(200);
      const meta = await sharp(r.json.jpg_path).metadata();
      expect(meta, t).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
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
      expect(r.status, name).toBe(500);
      expect(r.json.error, name).toMatch(/rejected/i);
    }
  });

  it("the request guard lets through only what a post needs", async () => {
    rmSync(PROBE_FILE, { force: true });
    await post(base("guard", { template_html: buildTemplateHtml(DEFAULT_CONFIG), home_logo: "https://media.example/home.png" }));
    expect(existsSync(PROBE_FILE)).toBe(true);
    const d = JSON.parse(readFileSync(PROBE_FILE, "utf8")) as Record<string, string>;
    const allowed = [PROBES[0], PROBES[1], PROBES[2], PROBES[3], PROBES[6], PROBES[7], PROBES[8], PROBES[9]];
    const blocked = [PROBES[4], PROBES[5], PROBES[10], PROBES[11], PROBES[12], PROBES[13], PROBES[14]];
    for (const u of allowed) expect(d[u], u).toBe("allow");
    for (const u of blocked) expect(d[u], u).toBe("block");
  });

  it("built-in templates are our own files and are drawn without the guard", async () => {
    rmSync(PROBE_FILE, { force: true });
    await post(base("noguard", { template: "frame" }));
    expect(existsSync(PROBE_FILE)).toBe(false);
  });

  it("stays up after a broken request", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", body: "this is not json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await post(base("after", { template: "classic" }))).status).toBe(200);
  });
});
