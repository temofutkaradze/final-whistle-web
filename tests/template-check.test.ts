import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_HTML_CHARS, checkTemplateHtml, withCsp } from "../render/template-check.js";

// A minimal valid template with every placeholder a result post needs. `extra` is added just before </body>.
const page = (extra = "") =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=1080"><style>body{width:1080px;height:1350px}</style></head>` +
  `<body><img src="{{BACKGROUND}}">{{PAGE_NAME}}{{HOME_NAME}}{{AWAY_NAME}}{{HOME_SCORE}}-{{AWAY_SCORE}}{{HOME_EVENTS}}${extra}</body></html>`;

describe("the safety check for customer templates", () => {
  it("accepts every built-in template", () => {
    const dir = join(__dirname, "..", "render", "templates");
    const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const r = checkTemplateHtml(readFileSync(join(dir, f), "utf8"));
      expect(r.errors, f).toEqual([]);
    }
  });

  it("accepts a plain template", () => {
    expect(checkTemplateHtml(page())).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("accepts the things it must allow: Google Fonts, data: pictures and placeholders in CSS", () => {
    const allowed = [
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link href="https://fonts.googleapis.com/css2?family=Oswald&display=swap" rel="stylesheet">',
      '<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,600;0,800&display=swap" rel="stylesheet">',
      '<img src="data:image/png;base64,AAAA">',
      "<div style=\"background:url('data:image/svg+xml;utf8,<svg></svg>')\"></div>",
      "<style>.x{background:url({{BACKGROUND}})}</style>",
    ];
    for (const extra of allowed) expect(checkTemplateHtml(page(extra)).ok, extra).toBe(true);
  });

  const attacks: Record<string, string> = {
    script: "<script>alert(1)</script>",
    "script, upper case": "<SCRIPT src=x></SCRIPT>",
    iframe: '<iframe src="x"></iframe>',
    object: '<object data="x"></object>',
    "onerror attribute": '<img src="data:image/png;base64,AA" onerror="alert(1)">',
    "onerror without space": "<img/onerror=alert(1) src=x>",
    "onclick attribute": '<div onclick="x()">a</div>',
    "javascript: link": '<a href="javascript:alert(1)">x</a>',
    "javascript: with a tab inside": '<a href="java\tscript:alert(1)">x</a>',
    "http image": '<img src="http://evil.example/x.png">',
    "https image": '<img src="https://evil.example/x.png">',
    "file image": '<img src="file:///C:/Windows/win.ini">',
    "file in css": '<div style="background:url(file:///C:/x.png)"></div>',
    "css escape for file:": '<div style="background:url(\\66ile:///C:/x.png)"></div>',
    "css @import string": '<style>@import "http://evil.example/a.css";</style>',
    "css @import url()": "<style>@import url(http://evil.example/a.css);</style>",
    "placeholder with ../ appended": '<img src="{{BACKGROUND}}/../../x">',
    "placeholder with text appended": '<img src="{{HOME_LOGO}}x">',
    form: '<form action="http://x"><input></form>',
    base: '<base href="http://x/">',
    "meta refresh": '<meta http-equiv="refresh" content="0;url=http://x">',
    "css image-set": "<div style=\"background-image:image-set('a.png' 1x)\"></div>",
    "css expression": '<div style="width:expression(alert(1))"></div>',
    "external stylesheet": '<link rel="stylesheet" href="http://evil.example/a.css">',
    "svg use of an outside file": '<svg><use href="http://evil.example/a.svg#x"/></svg>',
    "svg animate href": '<svg><set attributeName="href" to="x"/></svg>',
    "html entity for http": '<img src="&#104;ttp://evil.example/x.png">',
    srcset: '<img srcset="http://evil.example/a.png 1x">',
    video: '<video src="x"></video>',
    "protocol-relative css url": '<style>.a{background:url("//evil.example/x.png")}</style>',
  };
  for (const [name, html] of Object.entries(attacks)) {
    it(`refuses: ${name}`, () => {
      const r = checkTemplateHtml(page(html));
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });
  }

  it("refuses an empty, missing or oversized template", () => {
    expect(checkTemplateHtml("").ok).toBe(false);
    expect(checkTemplateHtml("   ").ok).toBe(false);
    expect(checkTemplateHtml(null).ok).toBe(false);
    expect(checkTemplateHtml(42).ok).toBe(false);
    expect(checkTemplateHtml("x".repeat(MAX_HTML_CHARS + 1)).ok).toBe(false);
  });

  it("requires the placeholders a post cannot do without", () => {
    for (const name of ["HOME_SCORE", "AWAY_SCORE", "HOME_NAME", "AWAY_NAME"]) {
      const r = checkTemplateHtml(page().replace(`{{${name}}}`, ""));
      expect(r.ok, name).toBe(false);
      expect(r.errors.join(" ")).toContain(`{{${name}}}`);
    }
  });

  it("warns (but does not refuse) about likely mistakes", () => {
    const html = "<html>{{HOME_NAME}}{{AWAY_NAME}}{{HOME_SCORE}}{{AWAY_SCORE}}{{FOO}}{{ home_name }}</html>";
    const r = checkTemplateHtml(html);
    expect(r.ok).toBe(true);
    const text = r.warnings.join("\n");
    expect(text).toContain("{{FOO}}");
    expect(text).toContain("{{ home_name }}");
    expect(text).toContain("{{BACKGROUND}}");
    expect(text).toContain("{{PAGE_NAME}}");
    expect(text).toContain("1080 x 1350");
  });

  it("does not mistake CSS comments or plain text for attributes", () => {
    // "BACKGROUND ====" once looked like a background= attribute
    const r = checkTemplateHtml(page("<style>/* ======\n BACKGROUND\n ====== */ body { color: red }</style><p>data = 5, src = 3</p>"));
    expect(r.ok).toBe(true);
  });
});

describe("withCsp", () => {
  it("puts the policy first in <head>, before any picture or style", () => {
    const out = withCsp(page());
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<img"));
    expect(out).toContain("script-src 'none'");
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("form-action 'none'");
  });

  it("also works for a fragment without <head>", () => {
    expect(withCsp("<div>{{X}}</div>").startsWith("<head><meta http-equiv")).toBe(true);
    expect(withCsp("<html><body>x</body></html>")).toMatch(/^<html><head><meta http-equiv/);
  });
});
