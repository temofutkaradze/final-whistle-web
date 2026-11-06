import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_HTML_CHARS, checkTemplateHtml, withCsp, collectUrls } from "../render/template-check.js";

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


describe('unsupported CSS URL escapes',()=>{
 it.each([
  String.raw`<style>.x{background-image:u\72l("data:image/png;base64,AAAA")}</style>`,
  String.raw`<style>.x{background-image:\75\72\6c("data:image/png;base64,AAAA")}</style>`,
  '<div style="background-image:u&#92;72l(data:image/png;base64,AAAA)"></div>',
  '<div style="background-image:u&#x5c;72l(data:image/png;base64,AAAA)"></div>',
  '<div style="background-image:u&bsol;72l(data:image/png;base64,AAAA)"></div>',
 ])('rejects literal or HTML-encoded escapes before Chromium: %s',extra=>{
  expect(checkTemplateHtml(page(extra)).ok).toBe(false);
 });
});


describe('HTML references cannot conceal CSS resource syntax',()=>{
 const image='data:image/png;base64,AAAA';
 it.each([
  'u&#114;l', 'u&#x72;l', 'u&#X000072;l', 'u&#114l', 'u&#x72l',
  '&#117;&#114;&#108;', 'U&#82;L',
 ])('rejects encoded identifiers, including missing semicolons: %s',name=>{
  expect(checkTemplateHtml(page('<div style="background-image:'+name+'('+image+')"></div>')).ok).toBe(false);
 });
 it.each([
  'url&lpar;&apos;'+image+'&apos;&rpar;',
  'url&lpar;&quot;'+image+'&quot;&rpar;',
  'url&lpar;data&colon;image/png;base64,AAAA&rpar;',
  'url&lpar;&Tab;data:image/png;base64,AAAA&rpar;',
 ])('rejects named references concealing URL punctuation: %s',css=>{
  expect(checkTemplateHtml(page('<div style="background-image:'+css+'"></div>')).ok).toBe(false);
 });
 it('covers unquoted styles, presentation attributes, and inline SVG style text',()=>{
  for(const markup of [
   '<div style=background-image:u&#114;l('+image+')></div>',
   '<svg><rect fill="u&#x72;l('+image+')"/></svg>',
   '<svg><style>rect{fill:u&#114;l('+image+')}</style><rect/></svg>',
   '<div STYLE="background-image:u&#114l('+image+')"></div>',
   '<div style="background-image:image&hyphen;set('+image+')"></div>',
  ])expect(checkTemplateHtml(page(markup)).ok,markup).toBe(false);
 });
 it('preserves normal CSS, raw/escaped font query ampersands and text entities',()=>{
  for(const markup of [
   '<link href="https://fonts.googleapis.com/css2?family=Oswald&amp;display=swap" rel="stylesheet">',
   '<link href="https://fonts.googleapis.com/css2?family=Oswald&display=swap" rel="stylesheet">',
   '<div style="color:red;background-image:url({{BACKGROUND}})"></div>',
   '<div title="A &amp; B">&copy; &#8220;A &amp; B&#8221;</div>',
  ])expect(checkTemplateHtml(page(markup)).ok,markup).toBe(true);
 });
});


describe('one quote-aware boundary model', () => {
  it.each([
    '<svg><style title="> </style>">.x{background-image:u&#114;l(data:image/png;base64,AAAA)}</style></svg>',
    "<svg><style title='> </style>'>.x{background-image:u&#x72l(data:image/png;base64,AAAA)}</style></svg>",
    '<SVG><STYLE title="> </STYLE>">.x{background-image:url&lpar;data:image/png;base64,AAAA&rpar;}</STYLE></SVG>',
  ])('rejects the exact SVG attack and adjacent quote/case variants: %s', markup => {
    expect(checkTemplateHtml(page(markup)).ok).toBe(false);
  });
  it('collects a literal image after the real quoted opening-tag boundary', () => {
    const markup = '<svg><style title="> </style>">.x{background-image:url(data:image/png;base64,AAAA)}</style></svg>';
    expect(checkTemplateHtml(page(markup)).ok).toBe(true);
    expect(collectUrls(page(markup))).toContain('data:image/png;base64,AAAA');
  });
  it.each([
    '<style title="> </style>">.x{color:red}',
    '<style/>.x{background-image:u&#114;l(data:image/png;base64,AAAA)}</style>',
    '<style>.x{color:red}</style bad>',
    '<div title=x"broken> <svg><style>.x{background-image:u&#114;l(data:image/png;base64,AAAA)}</style></svg>',
    '<div class="x"style="color:red"></div>',
    '<div style="color:red" style="background-image:u&#114;l(data:image/png;base64,AAAA)"></div>',
    '<!--> <svg><style>.x{background-image:u&#114;l(data:image/png;base64,AAAA)}</style></svg> -->',
    '<title><style>.x{color:red}</style></title>',
  ])('fails closed on ambiguous/repaired markup: %s', markup => {
    expect(checkTemplateHtml(page(markup)).ok).toBe(false);
  });
  it('does not collect attribute-looking strings as real URL attributes', () => {
    expect(collectUrls(page('<div title="src=data:font/woff;base64,AAAA"></div>'))).not.toContain('data:font/woff;base64,AAAA');
  });
  it('places CSP after a complete quoted head opener', () => {
    const opener = '<head title="> </head>">';
    const html = '<html>' + opener + '<title>Example</title></head><body>Text</body></html>';
    const output = withCsp(html);
    expect(output.indexOf('Content-Security-Policy')).toBeGreaterThan(output.indexOf(opener) + opener.length);
  });
  it('supports vector SVGs, ordinary styles, query ampersands and text entities', () => {
    const markup = '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#g)"/></svg><div title="A &amp; B">&#8220;A &copy; B&#8221;</div>';
    expect(checkTemplateHtml(page(markup)).ok).toBe(true);
  });
  it.each([
    '<img src="data:font/woff;base64,AAAA">',
    '<style>@font-face{font-family:x;src:url(data:font/woff;base64,AAAA)}</style>',
    '<img srcset="{{HOME_LOGO}} 1x">',
    '<link rel="preload" as="image" imagesrcset="{{HOME_LOGO}} 1x">',
    '<img src="{{PAGE_NAME}}">',
    '<style>.x{background-image:image("data:image/png;base64,AAAA")}</style>',
  ])('rejects resource forms the collector cannot validate safely: %s', markup => {
    expect(checkTemplateHtml(page(markup)).ok).toBe(false);
  });
});

describe('CSS sources have independent string/comment-aware boundaries', () => {
  const image = 'data:image/png;base64,AAAA';
  const decoys = [
    '<style>/* url(\'# */ .x{background-image:url('+image+')} /* \') */</style>',
    '<div title="url(\'#"></div><div style="background-image:url('+image+')"></div><div title="\')"></div>',
    '<div style="--text: &amp;; background:url('+image+')"></div>',
    '<style>.x{content:"url(\'#";background:url('+image+');--text:"\')"}</style>',
    '<div style="/* url(\'# */ background:url('+image+'); /* \') */"></div>',
    '<svg><rect fill="url('+image+')"/><rect stroke="url(#g)"/></svg>',
    '<style>.x{--photo:url('+image+');background:var(--photo)}</style>',
    '<style>/* url(\'# */</style><div style="background:URL( \''+image+'\' )"></div>',
  ];
  it.each(decoys)('collects the actual resource instead of a decoy: %s', extra => {
    const html = page(extra);
    expect(checkTemplateHtml(html).errors).toEqual([]);
    expect(collectUrls(html)).toContain(image);
  });
  it('ignores URL-looking plain text, HTML comments, CSS comments and strings', () => {
    const html = page('<p>url(data:font/woff;base64,AAAA)</p><!-- url(bad) --><div title="url(bad)"></div><style>/* url(bad) */ .x{content:"url(bad)"}</style>');
    expect(checkTemplateHtml(html).ok).toBe(true);
    expect(collectUrls(html)).not.toContain('bad');
    expect(collectUrls(html).filter(x=>x.startsWith('data:'))).toEqual([]);
  });
  it.each([
    '<style>/* unclosed</style>',
    '<div style="content: \'unclosed"></div>',
    '<style>.x{content:"bad\nline"}</style>',
    '<div style="background:url(\'data:image/png;base64,AAAA\' trailing)"></div>',
    '<div style="background:url(data:image/png;base64,AA AA)"></div>',
    '<div style="background:url(/* comment */data:image/png;base64,AAAA)"></div>',
    '<style>.x{background:url(data:image/png;base64,AAAA}</style>',
    '<style>.x{background:var(--x}</style>',
    '<style>@import/**/ "https://fonts.googleapis.com/css2?family=Oswald";</style>',
    '<style>.x{background:ImAgE-SeT("data:image/png;base64,AAAA" 1x)}</style>',
    '<style>.x{background:src("data:image/png;base64,AAAA")}</style>',
    '<div style="background:linear-gradient('+ '('.repeat(65) + 'red' + ')'.repeat(65) + ')"></div>',
  ])('rejects unsupported or malformed CSS instead of browser repair: %s', extra => {
    expect(checkTemplateHtml(page(extra)).ok).toBe(false);
  });
  it('bounds direct resource collection too',()=>{
    expect(()=>collectUrls(' '.repeat(MAX_HTML_CHARS+1))).toThrow();
  });
});

describe('SVG animation restrictions use parsed tags',()=>{
  it.each(['set','animate','animateTransform','animateMotion','animateColor','discard','SET','svg:animate'])('rejects %s regardless of quoting or attribute order', name=>{
    for(const attributes of [
      'title=">" attributeName="href" to="data:image/png;base64,AAAA"',
      "title='>' attributeName='xlink:href' values='data:image/png;base64,AAAA'",
      'attributeName="fill" title=">"',
    ])expect(checkTemplateHtml(page('<svg><'+name+' '+attributes+'/></svg>')).ok).toBe(false);
  });
  it('rejects meta HTTP directives after quoted angle brackets through parsed attributes',()=>{
    expect(checkTemplateHtml(page('<meta title=">" http-equiv="refresh" content="0">')).ok).toBe(false);
  });
  it('keeps static SVGs and harmless attribute text',()=>{
    expect(checkTemplateHtml(page('<svg><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect fill="url(#g)"/></svg><div title="onload=example; <set>">&copy; A &amp; B</div>')).ok).toBe(true);
  });
});
