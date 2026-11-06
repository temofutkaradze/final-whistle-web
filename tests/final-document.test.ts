import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {chromium,type Browser} from 'playwright';
import sharp from 'sharp';
import {prepareDocument,expandPlaceholders,previewDocument} from '../render/final-document.js';
import {fillPlaceholders,brandInnerHtml} from '../src/lib/sample-match';
import {buildTemplateHtml,DEFAULT_CONFIG,PRESETS,FONTS} from '../src/lib/template-builder';
const {prepareCustomDocument}=createRequire(import.meta.url)('../render/custom-resources.js');
let image:string,browser:Browser;
beforeAll(async()=>{image='data:image/png;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');browser=await chromium.launch();});
afterAll(async()=>{await browser?.close();});
const wrap=(html:string)=>'<!doctype html><html><head></head><body>'+html+'</body></html>';
describe('final standards-parsed resource boundary',()=>{
 it('finds functions assembled by placeholder expansion, including recursive-value decoys',async()=>{
  const original=wrap('<div style="background:u{{EVENTS_CLASS}}rl('+image+')"></div>');
  const expanded=expandPlaceholders(original,{'{{EVENTS_CLASS}}':''});
  expect(prepareDocument(expanded).resources).toEqual([image]);
  const final=await prepareCustomDocument(expanded,[]);expect(final.manifest.size).toBe(1);
  expect(final.html).not.toContain(image);expect(final.html).toContain('https://validated-template.invalid/');
  expect(()=>prepareDocument(expandPlaceholders(wrap('<div style=\'background:image-{{EVENTS_CLASS}}set("x" 1x)\'></div>'),{'{{EVENTS_CLASS}}':''}))).toThrow();
  expect(expandPlaceholders('{{HOME_NAME}}',{'{{HOME_NAME}}':'{{AWAY_NAME}}','{{AWAY_NAME}}':'bad'})).toBe('{{AWAY_NAME}}');
 });
 it('HTML5-decodes numeric, named and semicolonless attribute entities before CSS parsing',()=>{
  for(const token of ['u&#114;l','u&#x72;l','u&#000114l','u&#x00072l'])expect(prepareDocument(wrap('<div style="background:'+token+'('+image+')"></div>')).resources).toEqual([image]);
  expect(prepareDocument(wrap('<div style="background:url&lpar;&quot;'+image+'&quot;&rpar;"></div>')).resources).toEqual([image]);
  for(const bad of ['u&#92;72l','u&bsol;72l'])expect(()=>prepareDocument(wrap('<div style="background:'+bad+'('+image+')"></div>'))).toThrow();
 });
 it('keeps comments, strings, independent attributes and SVG CSS in their actual parsed sources',()=>{
  const sources=[
   '<style>/* url(\'# */ .p{background:url('+image+')} /* \') */</style>',
   '<div title="url(\'#"></div><div style="background:url('+image+')"></div><div title="\')"></div>',
   '<svg><style title="> </style>">.p{fill:url('+image+')}</style></svg>',
   '<svg><rect fill="url('+image+')"/></svg>',
   '<div style="--image:url('+image+');background:var(--image)"></div>',
  ];for(const html of sources)expect(prepareDocument(wrap(html)).resources).toEqual([image]);
 });
 it('fails closed for active content, animation, responsive sources, imports and ambiguous syntax',()=>{
  for(const html of ['<script>alert(1)</script>','<img onerror="x()">','<base href="https://evil.test">','<iframe srcdoc="x"></iframe>','<svg><set title=">" attributeName="href" to="x"/></svg>','<img srcset="'+image+' 1x">','<style>@import "https://evil.test/x";</style>','<style>.p{background:image-set("x" 1x)}</style>','<style>.p{--x: url("unterminated)}</style>','<div style="background:url(https://evil.test/x)"></div>','<div style="background:url(javascript:alert(1))"></div>','<div style="color:red" style="background:url(x)"></div>'])expect(()=>prepareDocument(wrap(html)),html).toThrow();
 });
 it('validates images introduced through context changes before constructing any page',async()=>{
  const oversized='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>');
  await expect(prepareCustomDocument(wrap('<div style="background:url('+oversized+')"></div>'),[])).rejects.toMatchObject({statusCode:400});
  await expect(prepareCustomDocument(wrap('<img src="file:///C:/final-whistle-web/.env">'),[])).rejects.toBeDefined();
 });
 it('supports text entities, literal query ampersands, ordinary vector SVG and foreignObject layouts',()=>{
  const html=wrap('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald&amp;display=swap"><p>A &amp; B &lt; C &#169;</p><svg><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"/><foreignObject width="1" height="1"><div>Text</div></foreignObject></svg>');
  const result=prepareDocument(html);expect(result.resources).toEqual([]);expect(result.html).toContain('family=Oswald&amp;display=swap');expect(result.html).toContain('A &amp; B &lt; C \u00a9');
 });
 it('preserves builtin-as-custom and every Template Builder preset/font in final previews',()=>{
  for(const name of ['classic','panel','frame','stripe'])expect(previewDocument(fillPlaceholders(readFileSync('render/templates/'+name+'.html','utf8'),brandInnerHtml('Final Whistle',null))),name).not.toBe('');
  for(const patch of [...PRESETS.map(p=>p.patch),...Object.keys(FONTS).map(font=>({font:font as keyof typeof FONTS}))])expect(previewDocument(fillPlaceholders(buildTemplateHtml({...DEFAULT_CONFIG,...patch}),brandInnerHtml('Final Whistle',null)))).not.toBe('');
 });
 it('Chromium renders validated manifest bytes and CSP blocks unvalidated data images',async()=>{
  const final=await prepareCustomDocument(wrap('<img id="ok" src="'+image+'"><div style="background:url('+image+')"></div>'),[]);
  const page=await browser.newPage();try{
   await page.route('**/*',route=>{const asset=final.manifest.get(route.request().url());return asset?route.fulfill({body:asset.body,contentType:asset.contentType}):route.abort();});
   await page.setContent(final.html);expect(await page.locator('#ok').evaluate(async node=>{const img=node as HTMLImageElement;await img.decode();return img.naturalWidth;})).toBe(1);
   expect(await page.evaluate(async uri=>{const img=document.createElement('img');img.src=uri;document.body.append(img);try{await img.decode();return true;}catch{return false;}},image)).toBe(false);
  }finally{await page.close();}
 });
});

it('blocks serialization/context mutation and post-expansion active markup',()=>{
 for(const field of ['<script>alert(1)</script>','<svg><animate attributeName="href" to="x"/></svg>','<meta charset="iso-2022-jp">','<style>@import "https://evil.test/x";</style>'])expect(()=>prepareDocument(expandPlaceholders(wrap('{{PAGE_NAME}}'),{'{{PAGE_NAME}}':field}))).toThrow();
 for(const html of ['<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">','<svg><foreignObject><p><style><!--</style><img src="https://evil.test/x"></p></foreignObject></svg>'])expect(()=>prepareDocument(wrap(html))).toThrow();
});
it('keeps preview expansion final and rejects placeholder-introduced image functions',()=>{
 expect(previewDocument(expandPlaceholders(wrap('<div style=\'background:image-{{EVENTS_CLASS}}set("x" 1x)\'></div>'),{'{{EVENTS_CLASS}}':''}))).toBe('');
 expect(previewDocument(wrap('<p>A &amp; B &#169;</p><svg><circle r="1"/></svg>'))).not.toBe('');
});
it('validates referenced SVG bytes as self-contained images, including nested/animation encodings',async()=>{
 for(const svg of ['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="data:image/png;base64,AAAA"/></svg>','<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>.x{background:u\\72l(data:image/png,AAAA)}</style></svg>']){
  const uri='data:image/svg+xml,'+encodeURIComponent(svg);await expect(prepareCustomDocument(wrap('<img src="'+uri+'">'),[])).rejects.toBeDefined();
 }
});
