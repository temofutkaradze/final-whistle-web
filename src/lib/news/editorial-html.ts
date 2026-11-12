import type {Job} from './parse.ts';
import {EDITORIAL_TEMPLATES} from './editorial.ts';
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const highlighted=(value:string)=>value.split('*').map((part,index)=>index%2?`<span class="yellow">${escape(part)}</span>`:escape(part)).join('');

/** Uses the existing News capture/export path, full-source RGB and bundled fonts. */
export function buildEditorialHtml(job:Job,background:string,fonts:string){
  const design=job.editorial;
  if(!design||!Object.hasOwn(EDITORIAL_TEMPLATES,design.template)||typeof design.headline!=='string'||!design.headline.replace(/\*/g,'').trim()||design.headline.length>300||typeof design.subtitle!=='string'||design.subtitle.length>450)throw Error('Invalid editorial template or text');
  const framed=design.template==='news-red'||design.template==='did-you-know';
  const subtitle=design.template==='headline-subtitle';
  const label=design.template==='news-red'?'NEWS':'DID YOU KNOW';
  const color=design.template==='news-red'?'#a22e2a':'#f5d428';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:2160px;height:2700px;overflow:hidden;background:#080a10}
.post{position:relative;width:1080px;height:1350px;transform:scale(2);transform-origin:0 0;overflow:hidden}
#background{position:absolute;max-width:none}
.shade{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 48%,rgba(0,0,0,.12) 62%,rgba(0,0,0,${framed?'.48':'.98'}) 100%)}
.copy{position:absolute;left:70px;right:70px;bottom:92px;text-align:center;display:flex;flex-direction:column;align-items:center}
#headline{width:100%;font:400 ${subtitle?80:94}px/1.04 Anton,'League Gothic',Impact,sans-serif;text-transform:uppercase;white-space:pre-wrap;overflow-wrap:anywhere;text-wrap:balance;color:#fff;-webkit-text-stroke:0}
.yellow{color:#ffff00}#subtitle{width:100%;margin-top:32px;font:400 39px/1.2 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;color:#fff;text-wrap:balance}
.frame{position:absolute;left:64px;right:64px;bottom:92px;height:244px;border:2px solid ${color};border-top:0;display:flex;align-items:center;justify-content:center;padding:40px 32px 22px}
.label-row{position:absolute;left:-2px;right:-2px;top:0;transform:translateY(-50%);display:flex;align-items:center;gap:22px}
.label-row::before,.label-row::after{content:'';flex:1;height:2px;background:${color}}
.label{flex:none;color:${color};font:400 ${design.template==='news-red'?70:54}px/1 Anton,'League Gothic',sans-serif;letter-spacing:${design.template==='news-red'?12:0}px}
.frame #headline{font-size:68px;line-height:1.04;text-align:center}
</style></head><body><div class="post"><img id="background" src="${background}"><div class="shade"></div>
${framed?`<div class="frame"><div class="label-row"><span class="label">${label}</span></div><div id="headline">${highlighted(design.headline)}</div></div>`:`<div class="copy"><div id="headline">${highlighted(design.headline)}</div>${subtitle?`<div id="subtitle">${highlighted(design.subtitle)}</div>`:''}</div>`}
</div><script>
const bg=document.getElementById('background');
function fitText(el,maxHeight){let size=parseFloat(getComputedStyle(el).fontSize);while(size>8&&(el.scrollHeight>maxHeight||el.scrollWidth>el.clientWidth)){size--;el.style.fontSize=size+'px';}}
Promise.all([bg.decode(),document.fonts.load('94px "League Gothic"'),document.fonts.load('68px Anton')]).then(()=>{
 const scale=Math.max(1080/bg.naturalWidth,1350/bg.naturalHeight),width=bg.naturalWidth*scale,height=bg.naturalHeight*scale;
 bg.style.width=width+'px';bg.style.height=height+'px';bg.style.left=(1080-width)/2+'px';bg.style.top=(1350-height)/2+'px';
 fitText(document.getElementById('headline'),${framed?166:subtitle?210:310});const sub=document.getElementById('subtitle');if(sub)fitText(sub,112);
 document.documentElement.setAttribute('data-ready','1');
}).catch(()=>{document.documentElement.setAttribute('data-error','Editorial image or font could not load');document.documentElement.setAttribute('data-ready','1');});
</script></body></html>`;
}
