// Run after benchmark completion. Review images are separate from production outputs.
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
import {median} from './metrics.mjs';
const dir=path.resolve('storage/quality/results'),r=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'));
// Keep the interrupted 22MP stress samples in the raw results, not in balanced
// four-fixture / eight-template averages.
r.rows=r.rows.filter(x=>!x.id.startsWith('photo-high-'));r.captures=r.captures.filter(x=>!x.id.startsWith('photo-high-'));
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const labels=[...new Set(r.rows.map(x=>x.label))];
const summary=labels.map(label=>{const a=r.rows.filter(x=>x.label===label);return {label,n:a.length,meanKiB:mean(a.map(x=>x.bytes))/1024,meanPsnr:mean(a.map(x=>x.psnrDb)),meanSsim8:mean(a.map(x=>x.ssim8)),medianEncodeMs:median(a.map(x=>x.encodeMedianMs)),medianCpuMs:median(a.map(x=>x.nodeCpuMedianMs))};});
const byKind={};for(const kind of ['match','news']){
 const ids=r.captures.filter(x=>x.scale===2&&x.kind===kind).map(x=>x.id);
 byKind[kind]=labels.map(label=>{const a=r.rows.filter(x=>x.label===label&&ids.includes(x.id));return a.length?{label,n:a.length,meanKiB:mean(a.map(x=>x.bytes))/1024,meanPsnr:mean(a.map(x=>x.psnrDb)),meanSsim8:mean(a.map(x=>x.ssim8)),medianEncodeMs:median(a.map(x=>x.encodeMedianMs)),medianCpuMs:median(a.map(x=>x.nodeCpuMedianMs))}:null;}).filter(Boolean);
}
const scaleSummary=[];for(const scale of [1,2,3])for(const kind of ['match','news']){
 const a=r.captures.filter(x=>x.scale===scale&&x.kind===kind&&['chart-portrait','photo-6mp'].includes(x.fixture));
 if(a.length)scaleSummary.push({scale,kind,n:a.length,medianRenderMs:median(a.map(x=>x.renderMedianMs)),medianNodeCpuMs:median(a.map(x=>x.nodeCpuMedianMs))});
}
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({environment:r.environment,summary,byKind,scaleSummary,metricsNote:'PSNR/SSIM compare decoded RGB to clean, lossless 2x Lanczos3 final-size pixels. Kernel/scale differences indicate deviation, not objective inferiority. Grain comparisons intentionally quantify alteration of clean pixels.'},null,2));
console.log(JSON.stringify({summary,byKind,scaleSummary},null,2));
const ids=r.captures.filter(x=>x.scale===2).map(x=>x.id),options=ids.map(id=>`<option>${id}</option>`).join('');
fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Final Whistle image-quality comparison</title><style>body{font:16px system-ui;background:#101415;color:#eee;margin:24px}select,a{font:inherit;color:inherit;background:#242c2b;padding:8px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}img{width:100%;height:auto}figure{margin:12px 0}p{max-width:1000px}button{padding:8px}code{color:#b7e0c0}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>Final Whistle — local image-quality comparison</h1><p>Before: production Q93; Match includes fixed sigma-5 grain. Candidates: clean Q95/Q97, 4:4:4, unchanged 2x capture and Lanczos3. The lossless reference has no added grain. No AI or detail reconstruction. Click an image to inspect original pixels.</p><p>Photographic fixture: <a href="https://pxhere.com/en/photo/1102099">CC0 sports photograph</a>. Existing public low-resolution example and original synthetic charts are also included.</p><label>Fixture and template <select id="choice">${options}</select></label><main id="images"></main><p><a href="summary.json">Summary measurements</a> · <a href="results.json">All measurements</a> · <a href="process-metrics.json">Sampled process-tree CPU/RAM</a></p><script>const choice=document.querySelector('#choice');function show(){document.querySelector('#images').innerHTML=[['before.jpg','Before: Q93 / Match grain'],['q95-444.jpg','Q95 / no added grain'],['after.jpg','Selected Q97 / sRGB ICC / no added grain'],['q100-444.jpg','Q100 / no added grain'],['q95-420.jpg','Q95 / 4:2:0'],['reference.png','Lossless final-size reference']].map(([suffix,label])=>'<figure><figcaption>'+label+'</figcaption><a href="'+choice.value+'-'+suffix+'"><img src="'+choice.value+'-'+suffix+'" alt="'+label+'"></a></figure>').join('')}choice.onchange=show;show();</script></html>`);
if(process.argv.includes('--images')){
 const review=path.join(dir,'review');fs.mkdirSync(review,{recursive:true});
 const header=text=>Buffer.from(`<svg width="540" height="40"><rect width="540" height="40" fill="#151a1b"/><text x="16" y="27" fill="white" font-family="sans-serif" font-size="18">${text}</text></svg>`);
 for(const id of ids){
  const before=await sharp(path.join(dir,id+'-before.jpg')).resize(540,675).png().toBuffer(),after=await sharp(path.join(dir,id+'-q97-444.jpg')).resize(540,675).png().toBuffer();
  await sharp({create:{width:1080,height:715,channels:3,background:'#151a1b'}}).composite([{input:header('BEFORE — Q93'),left:0,top:0},{input:header('CANDIDATE — Q97, no added grain'),left:540,top:0},{input:before,left:0,top:40},{input:after,left:540,top:40}]).png().toFile(path.join(review,id+'.png'));
 }
 for(const id of ['chart-portrait-match-classic','chart-portrait-news-breaking','photo-6mp-match-classic','photo-6mp-news-left']){
  const comps=[];const variants=['before.jpg','q95-444.jpg','q97-444.jpg','q100-444.jpg'];
  const crops=[{left:400,top:430,width:180,height:180},{left:400,top:1000,width:180,height:180},{left:20,top:1100,width:180,height:180}];
  for(let col=0;col<4;col++)for(let row=0;row<3;row++){const input=await sharp(path.join(dir,id+'-'+variants[col])).extract(crops[row]).resize(360,360,{kernel:'nearest'}).png().toBuffer();comps.push({input,left:col*360,top:40+row*360});}
  const title=Buffer.from(`<svg width="1440" height="40"><rect width="1440" height="40" fill="#151a1b"/>${['BEFORE','Q95','Q97','Q100'].map((t,i)=>`<text x="${i*360+20}" y="27" fill="white" font-family="sans-serif" font-size="18">${t}</text>`).join('')}</svg>`);
  await sharp({create:{width:1440,height:1120,channels:3,background:'#151a1b'}}).composite([{input:title,left:0,top:0},...comps]).png().toFile(path.join(review,id+'-details.png'));
 }
}
