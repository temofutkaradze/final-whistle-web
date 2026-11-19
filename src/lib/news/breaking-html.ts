import type {Job} from './parse.ts';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// Use the original condensed Anton letterforms in both caption layouts.
const breakingLettering=`<svg viewBox="0 0 820 166" preserveAspectRatio="none" role="img" aria-label="BREAKING"><text id="breaking-word" fill="#ffffff" font-family="Anton" font-size="180" font-weight="400">BREAKING</text></svg>`;
export function buildBreakingHtml(job:Job,background:string,fonts:string){
  if(typeof job.breakingText!=='boolean'||typeof job.quote!=='string'||job.quote.length>600)throw Error('Invalid Breaking text');
  const text=job.quote.split('*').map((p,i)=>i%2?`<span class="yellow">${esc(p)}</span>`:esc(p)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:2160px;height:2700px;overflow:hidden;background:#080a10}
.post{width:1080px;height:1350px;transform:scale(2);transform-origin:0 0;position:relative;overflow:hidden}
#background{position:absolute;max-width:none}.shade{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.15) 52%,rgba(8,10,16,.7) 72%,#080a10 100%)}
.breaking-frame{position:absolute;left:76px;right:76px;${job.breakingText?'top:924px':'bottom:60px'};height:224px;border:3px solid #e52d32;padding:14px 20px;background:rgba(5,7,12,.2)}
.breaking-frame svg{display:block;width:100%;height:100%}
.breaking-summary{position:absolute;top:1184px;left:90px;right:90px;text-align:center;white-space:pre-wrap;text-wrap:balance;overflow-wrap:anywhere;color:#fff;font:800 42px/1.18 Montserrat,Arial,sans-serif;text-transform:uppercase}.yellow{color:#ffff00}
</style></head><body><div class="post"><img id="background" src="${background}"><div class="shade"></div><div class="breaking-frame">${breakingLettering}</div>${job.breakingText?`<div class="breaking-summary">${text}</div>`:''}</div>
<script>
const bg=document.getElementById('background');
Promise.all([bg.decode(),document.fonts.load('800 42px Montserrat'),document.fonts.load('180px Anton')]).then(()=>{
 const word=document.getElementById('breaking-word'),bounds=word.getBBox();
 word.setAttribute('transform','scale('+(820/bounds.width)+' '+(166/bounds.height)+') translate('+(-bounds.x)+' '+(-bounds.y)+')');
 const pos=${JSON.stringify(job.pos.b)},scale=Math.max(1080/bg.naturalWidth,1350/bg.naturalHeight)*pos[2],w=bg.naturalWidth*scale,h=bg.naturalHeight*scale;
 bg.style.width=w+'px';bg.style.height=h+'px';
 bg.style.left=Math.min(0,Math.max(1080-w,540-pos[0]/100*w))+'px';bg.style.top=Math.min(0,Math.max(1350-h,675-pos[1]/100*h))+'px';
 const summary=document.querySelector('.breaking-summary');if(summary){let size=42;while(size>12&&(summary.scrollHeight>116||summary.scrollWidth>summary.clientWidth)){summary.style.fontSize=(--size)+'px';}}
 document.documentElement.setAttribute('data-ready','1');
}).catch(()=>{document.documentElement.setAttribute('data-error','Breaking image or font could not load');document.documentElement.setAttribute('data-ready','1');});
</script></body></html>`;
}
