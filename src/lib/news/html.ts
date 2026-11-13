// The post itself: HTML that Chromium draws. (n8n node: Build HTML)
// Original n8n geometry: 1080x1350 post transformed by 2 inside a 2160x2700 viewport.
// Images are passed as data: URIs. The page's own script crops the images and shrinks the text until it fits,
// then sets data-ready on <html> so lib/render.ts knows when to take the screenshot.
import type { Job } from './parse';
import { DEFAULT_NEWS_STYLE, normalizeNewsStyle } from './parse.ts';
import { readFileSync } from 'node:fs';
import {buildEditorialHtml} from './editorial-html.ts';

export const bundledFonts = ([['League Gothic','leaguegothic',400],['Anton','anton',400],['Montserrat','montserrat',800]] as const)
  .map(([family,file,weight]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(new URL(`../../../render/fonts/${file}.ttf`,import.meta.url)).toString('base64')}) format('truetype');}`)
  .join('\n');

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const triple = (t: number[], d: number[]) => d.map((fallback,index)=>t?.[index]==null?fallback:Number.isFinite(t[index])?t[index]:fallback);

const sniff = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/jpeg');
const dataUri = (b: Buffer) => `data:${sniff(b)};base64,${b.toString('base64')}`;

export function buildHtml(job: Job, bgBuf: Buffer, circleBuf: Buffer | null): string {
  if(job.editorial)return buildEditorialHtml(job,dataUri(bgBuf),bundledFonts);
  const style = normalizeNewsStyle(job.style);
  const bgSrc = dataUri(bgBuf);
  const meta = {
    layout: job.layout,
    quote: job.quote,
    author: job.author,
    pos: { b: triple(job.pos.b, [50, 50, 1]), c: triple(job.pos.c, [50, 30, 1]) },
  };
  const circle = meta.layout !== 'single' && meta.layout !== 'breaking' && circleBuf ? dataUri(circleBuf) : null;

  const parts = meta.quote.split('*');
  const quoteHtml = parts.map((p, i) => (i % 2 ? '<span class="y">' + esc(p) + '</span>' : esc(p))).join('');
  const side = meta.layout === 'left' ? `left:${style.circleInset}px` : `left:${Math.max(0,1080 - style.circleSize - style.circleInset)}px`;
  // Built-in defaults get the headline-only treatment; saved customized BREAKING designs keep their styling.
  const builtInBreaking = meta.layout === 'breaking' && Object.entries(DEFAULT_NEWS_STYLE).every(([key,value]) => style[key as keyof typeof style] === value);
  const breakingHtml =
    meta.layout === 'breaking'
      ? '<div class="breaking-bottom' + (builtInBreaking ? ' breaking-headline' : '') + '"><div class="breaking-frame"><span>BREAKING</span></div>' + (builtInBreaking ? '' : '<div class="breaking-summary">' + esc(meta.quote) + '</div>') + '</div>'
      : '';
  const circleHtml = circle ? '<div class="circle" style="' + side + ';top:' + style.circleTop + 'px;width:' + style.circleSize + 'px;height:' + style.circleSize + 'px"><img id="ci" src="' + circle + '"></div>' : '';

  const font = style.font.replace(/[^a-zA-Z ]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8">
<title>News post</title>
<style>
${bundledFonts}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:2160px;height:2700px;overflow:hidden;background:#080a10}
.post{width:1080px;height:1350px;transform:scale(2);transform-origin:0 0;position:relative;overflow:hidden;background:#080a10}
.bg{position:absolute;left:0;top:0;max-width:none}
.shade{position:absolute;left:0;right:0;bottom:0;height:${style.shadeHeight}px;background:linear-gradient(to bottom,rgba(8,10,16,0),rgba(8,10,16,.92) 60%,#080a10)}
.circle{position:absolute;border-radius:${style.circleShape === 'circle' ? '50%' : style.circleShape === 'rounded' ? '48px' : '0'};border:${style.circleBorder}px solid ${style.circleBorderColor};overflow:hidden;background:#222}
.circle img{position:absolute;left:0;top:0;max-width:none}
.bottom{position:absolute;left:${style.textInset}px;right:${style.textInset}px;bottom:${style.textBottom}px;display:flex;flex-direction:column;align-items:center}
.rule{display:flex;align-items:center;justify-content:center;width:100%;padding:0 205px;margin-bottom:30px;height:65px}
.rule i{flex:1;height:2px;background:rgba(255,255,255,.55)}
.rule .quote-mark{display:block;margin:0 12px;height:65px;line-height:88px;font-family:Arial,sans-serif;font-size:112px;font-weight:900;color:${style.accent};letter-spacing:-14px;padding-right:14px}
.quote-mark>span{display:block;position:relative;transform:scale(.74);transform-origin:center top}
#q{position:relative;top:${style.textTop}px;font-family:'${font}',Anton,Impact,'Arial Narrow',sans-serif;font-size:${style.textSize}px;line-height:${style.lineHeight};${style.letterSpacing?`letter-spacing:${style.letterSpacing}px;`:''}-webkit-text-stroke:1.5px;text-align:${style.align};color:${style.textColor};text-transform:uppercase;text-wrap:balance;width:100%}
.y{color:${style.accent}}
.breaking-bottom{position:absolute;left:${Math.max(20,style.textInset-6)}px;right:${Math.max(20,style.textInset-6)}px;bottom:${style.textBottom+26}px;display:flex;flex-direction:column;align-items:center;${style.textTop!==-35?`transform:translateY(${style.textTop+35}px)`:''}}
.breaking-frame{width:100%;border:2px solid #e52d32;padding:10px 12px 8px;text-align:center;background:rgba(5,7,12,.42)}
.breaking-frame span{display:block;color:#fff;font-family:Anton,Impact,'Arial Narrow',sans-serif;font-size:118px;line-height:1.12;letter-spacing:2px;white-space:nowrap}
.breaking-summary{margin-top:${Math.max(0,style.authorGap-6)}px;max-width:940px;text-align:${style.align};color:${style.textColor};font:800 ${style.breakingSize}px/${style.lineHeight*1.22/1.04} '${style.breakingFont}',Arial,sans-serif;${style.letterSpacing?`letter-spacing:${style.letterSpacing}px;`:''}text-transform:uppercase;overflow-wrap:break-word;text-shadow:0 3px 9px #080a10}
${builtInBreaking ? `.breaking-headline{left:60px;right:60px;bottom:96px;transform:none}
.breaking-headline .breaking-frame{height:240px;padding:0 24px;display:flex;align-items:center;justify-content:center}
.breaking-headline .breaking-frame span{width:100%;font-size:230px;line-height:1;letter-spacing:1px}` : ''}
#a{position:relative;top:${style.textTop}px;margin-top:${style.authorGap}px;width:100%;text-align:${style.align};white-space:nowrap;font:800 ${style.authorSize}px Montserrat,Arial,sans-serif;letter-spacing:${style.authorTracking}px;color:${style.authorColor};text-transform:uppercase}
</style></head><body><div class="post">
<img class="bg" id="bgi" src="${bgSrc}">
<div class="shade"></div>
${circleHtml}
${breakingHtml}
<div class="bottom" style="${meta.layout === 'breaking' ? 'display:none' : ''}">
<div class="rule"><i></i><span class="quote-mark"><span>&#8220;</span></span><i></i></div>
<div id="q">${quoteHtml}</div>
<div id="a">${esc(meta.author)}</div>
</div></div>
<script>
var P=${JSON.stringify(meta.pos)};
function place(img,box,p){
  var cw=box.clientWidth,ch=box.clientHeight,fx=p[0]/100,fy=p[1]/100,z=p[2]||1;
  var s=Math.max(cw/img.naturalWidth,ch/img.naturalHeight)*z,dw=img.naturalWidth*s,dh=img.naturalHeight*s;
  img.style.width=dw+'px';img.style.height=dh+'px';
  img.style.left=Math.min(0,Math.max(cw-dw,cw/2-fx*dw))+'px';
  img.style.top=Math.min(0,Math.max(ch-dh,ch/2-fy*dh))+'px';
}
function ready(i){return i?i.decode():Promise.resolve();}
function fit(){
  var q=document.getElementById('q'),a=document.getElementById('a'),fs=${style.textSize};
  q.style.fontSize=fs+'px';
  function lines(){return Math.round(q.offsetHeight/(fs*${style.lineHeight}));}
  while(fs>40&&(lines()>3||(lines()===3&&fs>84)||q.scrollWidth>q.clientWidth)){fs-=2;q.style.fontSize=fs+'px';}
  var br=document.querySelector('.breaking-frame span'),bs=document.querySelector('.breaking-summary');
  if(br){var bf=${builtInBreaking ? 230 : 118};while(bf>64&&br.scrollWidth>br.clientWidth){bf-=2;br.style.fontSize=bf+'px';}}
  if(bs){var sf=${style.breakingSize};while(sf>22&&bs.offsetHeight>240){sf-=1;bs.style.fontSize=sf+'px';}}
  var as=${style.authorSize};
  while(as>16&&a.scrollWidth>a.clientWidth){as-=1;a.style.fontSize=as+'px';}
  // Center the actual quotation glyph ink, not its much taller font line box.
  var mark=document.querySelector('.quote-mark>span'),cs=getComputedStyle(mark);
  var ctx=document.createElement('canvas').getContext('2d');ctx.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
  var m=ctx.measureText(mark.textContent),asc=m.fontBoundingBoxAscent,desc=m.fontBoundingBoxDescent;
  if(Number.isFinite(asc)&&Number.isFinite(desc)){
    var baseline=(parseFloat(cs.lineHeight)-asc-desc)/2+asc;
    mark.style.top=(mark.parentNode.clientHeight/2-.74*(baseline+(m.actualBoundingBoxDescent-m.actualBoundingBoxAscent)/2))+'px';
  }
}
// The render server waits for data-ready before it takes the screenshot (this replaces Gotenberg's fixed "waitDelay 3s").
var done=false;
function finish(){
  if(done)return;done=true;
  fit();
  document.documentElement.setAttribute('data-ready','1');
}
var bgi=document.getElementById('bgi'),ci=document.getElementById('ci');
Promise.all([ready(bgi),ready(ci)]).then(function(){
  place(bgi,document.querySelector('.post'),P.b);
  if(ci)place(ci,ci.parentNode,P.c);
}).then(function(){return Promise.all([document.fonts.load('96px "${font}"'),document.fonts.load('118px Anton'),document.fonts.load('800 34px Montserrat')]);})
.then(finish,function(){document.documentElement.setAttribute('data-error','Image decode failed');document.documentElement.setAttribute('data-ready','1');});
</script></body></html>`;
}
