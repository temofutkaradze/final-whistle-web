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

const FORBIDDEN_TAGS = new Set('script iframe frame frameset object embed applet base form audio video source track portal'.split(' '));
// A strict lexical subset, not HTML error recovery. One set of boundaries feeds every check.
function scanTemplate(html) {
  const tags = [], styles = [];
  const space = c => c != null && /[\t\n\f\r ]/.test(c);
  const fail = () => { throw new Error('Malformed or unsupported template markup. Use quoted attributes and balanced style/title tags.'); };
  if (html.includes('\0')) fail();
  let pos = 0;
  while ((pos = html.indexOf('<', pos)) !== -1) {
    if (html.startsWith('<!--', pos)) {
      const end = html.indexOf('-->', pos + 4);
      if (end < 0) fail();
      const body = html.slice(pos + 4, end);
      if (/^(?:>|->)/.test(body) || body.includes('--!>') || body.includes('<!--')) fail();
      pos = end + 3; continue;
    }
    const doctype = /^<!doctype\s+html\s*>/i.exec(html.slice(pos));
    if (doctype) { pos += doctype[0].length; continue; }
    const closing = /^<\/([A-Za-z][A-Za-z0-9:-]*)[\t\n\f\r ]*>/.exec(html.slice(pos));
    if (closing) { pos += closing[0].length; continue; }
    const opening = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(pos));
    if (!opening) fail();
    const start = pos, name = opening[1].toLowerCase(), attributes = [];
    const names = new Set();
    pos += opening[0].length;
    let selfClosing = false;
    while (true) {
      const separator = pos;
      while (space(html[pos])) pos++;
      if (html[pos] === '>') { pos++; break; }
      if (html.startsWith('/>', pos)) { selfClosing = true; pos += 2; break; }
      if (pos === separator) fail();
      const attribute = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(html.slice(pos));
      if (!attribute) fail();
      const key = attribute[0].toLowerCase();
      if (names.has(key)) fail();
      names.add(key); pos += attribute[0].length;
      let equal = pos, value = null;
      while (space(html[equal])) equal++;
      if (html[equal] === '=') {
        pos = equal + 1;
        while (space(html[pos])) pos++;
        const quote = html[pos];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, pos + 1);
          if (end < 0) fail();
          value = html.slice(pos + 1, end); pos = end + 1;
        } else {
          const unquoted = /^[^\t\n\f\r "'\x60=<>]+/.exec(html.slice(pos));
          if (!unquoted) fail();
          value = unquoted[0]; pos += value.length;
        }
      }
      attributes.push({ name: key, value });
    }
    tags.push({ name, attributes, raw: html.slice(start, pos), start, end: pos });
    if (['script','textarea','xmp','plaintext','noembed','noframes','noscript'].includes(name)) fail();
    if (name === 'style' || name === 'title') {
      if (selfClosing) fail();
      const endTag = new RegExp('</' + name + '(?=[\\t\\n\\f\\r />])', 'ig');
      endTag.lastIndex = pos;
      const end = endTag.exec(html);
      if (!end) fail();
      const close = new RegExp('^</' + name + '[\\t\\n\\f\\r ]*>', 'i').exec(html.slice(end.index));
      if (!close) fail();
      const body = html.slice(pos, end.index);
      // Foreign-content markup and HTML raw-text repair are outside this supported subset.
      if (body.includes('<')) fail();
      if (name === 'style') styles.push(body);
      pos = end.index + close[0].length;
    }
  }
  return { tags, styles };
}
const SCRIPT_URL = /(?:java|vb)\s*script\s*:/i;
const SVG_ANIMATION_TAGS = new Set(['animate', 'set', 'animatetransform', 'animatemotion', 'animatecolor', 'discard']);

const URL_ATTRIBUTES = new Set('src href poster action formaction xlink:href data background ping manifest codebase usemap longdesc cite profile'.split(' '));
// SVG presentation attributes use CSS values, but unrelated HTML attributes are not CSS.
const CSS_ATTRIBUTES = new Set('style fill stroke filter clip-path mask marker marker-start marker-mid marker-end cursor color-profile'.split(' '));

// Linear, bounded lexical scan of ONE CSS source. No HTML-wide matching or CSS error recovery.
// Strings/comments cannot consume tokens in another source; unsupported resource syntax fails closed.
function cssUrls(css) {
  if (css.length > MAX_HTML_CHARS) throw new Error('CSS source is too long.');
  const found = [];
  const fail = () => { throw new Error('Malformed or unsupported CSS. Use literal url() values, balanced syntax and closed comments/strings.'); };
  const space = c => c != null && /[\t\n\f\r ]/.test(c);
  const nameChar = c => c != null && /[-_A-Za-z0-9\u0080-\uFFFF]/.test(c);
  let pos = 0;
  const string = () => {
    const quote = css[pos++], start = pos;
    while (pos < css.length && css[pos] !== quote) {
      if (/[\x00-\x1f\x7f\\]/.test(css[pos])) fail();
      pos++;
    }
    if (pos === css.length) fail();
    const value = css.slice(start, pos); pos++; return value;
  };
  const stack = [];
  while (pos < css.length) {
    const c = css[pos];
    if (space(c)) { pos++; continue; }
    if (css.startsWith('/*', pos)) {
      const end = css.indexOf('*/', pos + 2);
      if (end < 0) fail();
      pos = end + 2; continue;
    }
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f\\]/.test(c)) fail();
    if (c === '"' || c === "'") { string(); continue; }
    if (c === '@') {
      const start = ++pos; while (nameChar(css[pos])) pos++;
      // Imports can introduce another unparsed stylesheet. Use the existing Google Fonts link instead.
      if (['import', 'charset', 'namespace'].includes(css.slice(start, pos).toLowerCase())) fail();
      continue;
    }
    if (nameChar(c)) {
      const start = pos++; while (nameChar(css[pos])) pos++;
      const name = css.slice(start, pos).toLowerCase();
      if (name === 'behavior' || name === '-moz-binding') fail();
      if (css[pos] !== '(') continue;
      if (['expression','image','image-set','-webkit-image-set','cross-fade','-webkit-cross-fade','src'].includes(name)) fail();
      if (name !== 'url') continue;
      pos++; while (space(css[pos])) pos++;
      let value;
      if (css[pos] === '"' || css[pos] === "'") {
        value = string(); while (space(css[pos])) pos++;
      } else {
        const start = pos;
        while (pos < css.length && css[pos] !== ')' && !space(css[pos])) {
          if (/["'(\x00-\x1f\x7f\\]/.test(css[pos]) || css.startsWith('/*', pos)) fail();
          pos++;
        }
        value = css.slice(start, pos); while (space(css[pos])) pos++;
      }
      if (css[pos] !== ')') fail();
      pos++; found.push(value); continue;
    }
    if ('([{'.includes(c)) {
      if (stack.length >= 64) fail();
      stack.push(c);
    } else if (')]}'.includes(c) && stack.pop() !== ({')':'(',']':'[','}':'{'})[c]) fail();
    pos++;
  }
  if (stack.length) fail();
  return found;
}

function urlAllowed(value) {
  const v = String(value).trim();
  if (v === '') return true;
  if (/^\{\{(?:BACKGROUND|HOME_LOGO|AWAY_LOGO|LEAGUE_LOGO)\}\}$/.test(v)) return true;
  if (v.startsWith('#')) return true;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(v)) return true;
  if (/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/i.test(v)) return true;
  return false;
}

function collectUrls(html, parsed) {
  if (typeof html !== 'string' || html.length > MAX_HTML_CHARS) throw new Error('Template source is too long.');
  parsed ??= scanTemplate(html);
  const found = [];
  for (const tag of parsed.tags) for (const attribute of tag.attributes) {
    if (URL_ATTRIBUTES.has(attribute.name) && attribute.value != null) found.push(attribute.value.trim());
  }
  for (const css of parsed.styles) found.push(...cssUrls(css));
  for (const tag of parsed.tags) for (const attribute of tag.attributes) {
    if (CSS_ATTRIBUTES.has(attribute.name) && attribute.value != null) {
      // Attribute values are HTML-decoded once before Chromium parses their CSS.
      found.push(...cssUrls(attribute.value.replace(/&(?:amp|AMP);/g, '&')));
    }
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

  let parsed;
  try { parsed = scanTemplate(html); }
  catch (error) { return { ok: false, errors: [error.message], warnings }; }

  for (const name of REQUIRED) {
    if (!html.includes(`{{${name}}}`)) errors.push(`Missing {{${name}}}.`);
  }

  // Unsupported escapes cannot be allowed to hide CSS URL functions from collection.
  // Include HTML spellings of backslash used inside style/presentation attributes.
  if (/\\|&#(?:0*92|x0*5c);?|&bsol;?/i.test(html)) errors.push('Backslash escapes are not supported in custom templates. Use literal CSS identifiers and embedded image URLs.');

  // Browser HTML decoding happens before CSS parsing (also inside inline SVG style).
  // Reject ambiguous references in tag/attribute and style source, rather than partially decode them.
  // &amp; preserves ordinary query strings without concealing CSS functions or resource schemes.
  const entityContexts = [...parsed.tags.map(tag => tag.raw), ...parsed.styles];
  if (entityContexts.some(value => /&(?:#|[A-Za-z][A-Za-z0-9]*;|[A-Za-z][A-Za-z0-9]*(?=[^A-Za-z0-9=]|$))/.test(value.replace(/&amp;/gi, '')))) {
    errors.push('HTML character references are not supported in template attributes or styles, except &amp;. Use literal CSS and URL syntax.');
  }

  const forbidden = parsed.tags.find(tag => FORBIDDEN_TAGS.has(tag.name));
  if (forbidden) errors.push(`<${forbidden.name}> is not allowed (templates cannot run code or load other pages).`);
  if (parsed.tags.some(tag => tag.name === 'meta' && tag.attributes.some(attribute => attribute.name === 'http-equiv'))) errors.push('<meta http-equiv=...> is not allowed.');
  if (parsed.tags.some(tag => tag.attributes.some(attribute => /^on[a-z]{3,}$/.test(attribute.name)))) errors.push('Event attributes such as onclick= or onload= are not allowed.');
  if (SCRIPT_URL.test(html)) errors.push('javascript: links are not allowed.');
  if (parsed.tags.some(tag => SVG_ANIMATION_TAGS.has(tag.name.split(':').pop()))) errors.push('SVG animation elements are unsupported. Use static vector SVGs.');

  // Responsive candidates and data-font MIME aliases cannot be safely treated as validated images.
  if (parsed.tags.some(tag => tag.attributes.some(attribute => ['srcset','imagesrcset'].includes(attribute.name)))) errors.push('Responsive image candidates are unsupported. Use a validated image placeholder.');

  const bad = new Set();
  try {
    for (const u of collectUrls(html, parsed)) if (!urlAllowed(u)) bad.add(u.length > 60 ? u.slice(0, 57) + '...' : u);
  } catch (error) { errors.push(error.message); }
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
  const { tags } = scanTemplate(html);
  const head = tags.find(tag => tag.name === 'head');
  if (head) return html.slice(0, head.end) + CSP_META + html.slice(head.end);
  const root = tags.find(tag => tag.name === 'html');
  if (root) return html.slice(0, root.end) + '<head>' + CSP_META + '</head>' + html.slice(root.end);
  return '<head>' + CSP_META + '</head>' + html;
}

module.exports = { collectUrls, MAX_HTML_CHARS, KNOWN_PLACEHOLDERS, REQUIRED, checkTemplateHtml, withCsp };
