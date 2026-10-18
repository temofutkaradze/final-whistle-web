// template-check.js: the safety check for templates that customers write or paste themselves.
// One file, used in three places: the dashboard form (live feedback), the server action that saves a template,
// and render-server.js (which checks again before drawing, because it must never trust a request).
//
// A template is plain HTML + CSS with {{PLACEHOLDERS}}. It may NOT run code or load anything from outside:
// no scripts, no event attributes (onclick=...), no frames, no forms, no links to other sites.
// The only things it can load are placeholders, pictures embedded as data:, and Google Fonts.
'use strict';

const MAX_HTML_CHARS = 200000;

const KNOWN_PLACEHOLDERS = [
  'BACKGROUND', 'PAGE_NAME', 'LEAGUE_LOGO', 'HOME_LOGO', 'HOME_NAME', 'HOME_SCORE',
  'AWAY_SCORE', 'AWAY_LOGO', 'AWAY_NAME', 'HOME_EVENTS', 'AWAY_EVENTS', 'EVENTS_CLASS', 'TOTAL_EVENTS',
];
const REQUIRED = ['HOME_SCORE', 'AWAY_SCORE', 'HOME_NAME', 'AWAY_NAME'];

const FORBIDDEN_TAG = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|base|form|audio|video|source|track|portal)\b/i;
const META_HTTP_EQUIV = /<\s*meta\b[^>]*http-equiv/i;
const EVENT_ATTR = /[\s"'\/]on[a-z]{3,}\s*=/i;
// An HTML tag, quotes respected (a > inside an attribute value does not end the tag). Attributes only exist inside tags,
// so only tags are searched for them; plain text and CSS comments such as "BACKGROUND ====" are not.
const TAG = /<[a-zA-Z][^\s>\/]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
const SCRIPT_URL = /(?:java|vb)\s*script\s*:/i;
const ANIMATE_HREF = /<\s*(?:animate|set)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href/i;
const CSS_DANGER = /expression\s*\(|behavior\s*:|-moz-binding|(?:image-set|cross-fade)\s*\(|\bsrc\s*\(/i;

const ATTR_URL = /(?:^|[\s"'\/])(src|href|srcset|poster|action|formaction|xlink:href|data|background|ping|manifest|codebase|usemap|longdesc|cite|profile)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;

function urlAllowed(value) {
  const v = String(value).trim();
  if (v === '') return true;
  if (/^\{\{[A-Z_]+\}\}$/.test(v)) return true; // exactly a placeholder, nothing appended (no ../ tricks)
  if (v.startsWith('#')) return true;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(v)) return true;
  if (/^data:(font\/(woff2?|ttf|otf)|application\/(font-woff2?|x-font-[a-z0-9-]+))[;,]/i.test(v)) return true;
  if (/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/i.test(v)) return true;
  return false;
}

function collectUrls(html) {
  const found = [];
  let m;
  for (const tag of html.match(TAG) || []) {
    ATTR_URL.lastIndex = 0;
    while ((m = ATTR_URL.exec(tag))) {
      const raw = m[2] ?? m[3] ?? m[4] ?? '';
      if (m[1].toLowerCase() === 'srcset') {
        // srcset holds several "url size" pairs, separated by commas
        for (const part of String(raw).split(',')) found.push(part.trim().split(/\s+/)[0] || '');
      } else {
        found.push(String(raw).trim());
      }
    }
  }
  for (const re of [CSS_URL, CSS_IMPORT]) {
    re.lastIndex = 0;
    while ((m = re.exec(html))) found.push(String(m[1] ?? m[2] ?? m[3] ?? '').trim());
  }
  return found;
}

function checkTemplateHtml(html) {
  const errors = [];
  const warnings = [];
  if (typeof html !== 'string' || html.trim() === '') return { ok: false, errors: ['The template is empty.'], warnings };
  if (html.length > MAX_HTML_CHARS) {
    return { ok: false, errors: [`The template is too long (more than ${MAX_HTML_CHARS / 1000} KB).`], warnings };
  }

  for (const name of REQUIRED) {
    if (!html.includes(`{{${name}}}`)) errors.push(`Missing {{${name}}}.`);
  }

  const tag = html.match(FORBIDDEN_TAG);
  if (tag) errors.push(`<${tag[1].toLowerCase()}> is not allowed (templates cannot run code or load other pages).`);
  if (META_HTTP_EQUIV.test(html)) errors.push('<meta http-equiv=...> is not allowed.');
  if ((html.match(TAG) || []).some((t) => EVENT_ATTR.test(t))) errors.push('Event attributes such as onclick= or onload= are not allowed.');
  if (SCRIPT_URL.test(html)) errors.push('javascript: links are not allowed.');
  if (ANIMATE_HREF.test(html)) errors.push('Animating a link target is not allowed.');
  if (CSS_DANGER.test(html)) errors.push('This CSS feature (expression, behavior, image-set, src()) is not allowed.');

  const bad = new Set();
  for (const u of collectUrls(html)) if (!urlAllowed(u)) bad.add(u.length > 60 ? u.slice(0, 57) + '...' : u);
  for (const u of [...bad].slice(0, 5)) {
    errors.push(`"${u}" cannot be loaded. Only {{placeholders}}, pictures embedded as data: and Google Fonts are allowed.`);
  }

  // warnings: not fatal, but probably not what the author wants
  const seen = new Set();
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(html))) {
    if (!KNOWN_PLACEHOLDERS.includes(m[1]) || m[0] !== `{{${m[1]}}}`) seen.add(m[0]);
  }
  for (const s of [...seen].slice(0, 5)) warnings.push(`${s} is not a known placeholder and will show as plain text.`);
  if (!html.includes('{{BACKGROUND}}')) warnings.push('No {{BACKGROUND}}: the photo will not appear.');
  if (!html.includes('{{PAGE_NAME}}')) warnings.push('No {{PAGE_NAME}}: your page name or logo will not appear.');
  if (!html.includes('{{HOME_EVENTS}}') && !html.includes('{{AWAY_EVENTS}}')) warnings.push('No {{HOME_EVENTS}} / {{AWAY_EVENTS}}: scorers will not appear.');
  if (!/1080/.test(html) || !/1350/.test(html)) warnings.push('The image is 1080 x 1350 px. Set your page to that size.');

  return { ok: errors.length === 0, errors, warnings };
}

// Second safety layer for the browser that draws the template: even if something slipped through the check above,
// the page itself is told to run no script, open no connection and load nothing but pictures, styles and fonts.
const CSP =
  "default-src 'none'; img-src data: file: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; script-src 'none'; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

function withCsp(html) {
  const head = html.match(/<head[^>]*>/i);
  if (head) return html.slice(0, head.index + head[0].length) + CSP_META + html.slice(head.index + head[0].length);
  const root = html.match(/<html[^>]*>/i);
  if (root) return html.slice(0, root.index + root[0].length) + `<head>${CSP_META}</head>` + html.slice(root.index + root[0].length);
  return `<head>${CSP_META}</head>` + html;
}

module.exports = { MAX_HTML_CHARS, KNOWN_PLACEHOLDERS, REQUIRED, checkTemplateHtml, withCsp };
