// Execute the actual before/after exporter functions on the SAME real Chromium
// captures. Separate worker processes avoid shared Sharp caches/high-water RSS.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {spawnSync,execFileSync} from 'node:child_process';import sharp from 'sharp';
import {median,compareRgb} from './metrics.mjs';
const dir=path.resolve('storage/quality/results'),mode=process.argv[2];
if(!mode){
 const results={};for(const phase of ['before','after']){
  const child=spawnSync(process.execPath,[import.meta.filename,phase],{encoding:'utf8',maxBuffer:4*1024*1024});
  if(child.status!==0)throw Error(child.stderr||'Exporter validation failed');results[phase]=JSON.parse(child.stdout);
 }
 fs.writeFileSync(path.join(dir,'export-verification.json'),JSON.stringify(results,null,2));
 for(const [phase,r] of Object.entries(results))console.log(JSON.stringify({phase,cases:r.rows.length,medianMs:median(r.rows.map(x=>x.medianMs)),medianCpuMs:median(r.rows.map(x=>x.medianCpuMs)),peakNodeRssMiB:r.maxRssKiB/1024,allCandidatesIdentical:r.rows.every(x=>x.candidatePixelsIdentical)}));
}else{
 if(!['before','after'].includes(mode))throw Error('Invalid mode');
 const source=mode==='before'?execFileSync('git',['show','12c09a6:render/render-server.js'],{encoding:'utf8'}):fs.readFileSync('render/render-server.js','utf8');
 const constants=['FINAL_WIDTH','FINAL_HEIGHT','JPEG_QUALITY','GRAIN_SIGMA'].map(name=>{const m=source.match(new RegExp(`const ${name} = [0-9]+;`));if(!m)throw Error('Exporter constants changed');return m[0];}).join('\n');
 const fn=name=>{const start=source.indexOf(name==='makeJpeg'?'async function makeJpeg(':'function getGrain(');if(start<0)throw Error('Exporter function missing');return source.slice(start).match(/^[\s\S]*?\r?\n\}/)[0];};
 let seed=123456789;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const noise=Buffer.alloc(1080*1350*3);for(let i=0;i<noise.length;i++)noise[i]=Math.max(0,Math.min(255,Math.round(128+5*Math.sqrt(-2*Math.log(rnd()))*Math.cos(2*Math.PI*rnd()))));
 const grain=await sharp(noise,{raw:{width:1080,height:1350,channels:3}}).png().toBuffer();
 function fixedSharp(input,...args){return input?.create?.noise?sharp(grain):sharp(input,...args);}Object.assign(fixedSharp,sharp);
 const exporter=vm.runInNewContext(constants+'\nlet grainPromise=null;\n'+fn('getGrain')+'\n'+fn('makeJpeg')+'\nmakeJpeg',{sharp:fixedSharp});
 const cases=JSON.parse(fs.readFileSync(path.join(dir,'results.json'))).captures.filter(c=>c.scale===2&&!c.id.startsWith('photo-high-'));
 const rows=[];
 await exporter(fs.readFileSync(path.join(dir,cases[0].id+'-2x.png')),{grain:cases[0].kind==='match'});
 for(const c of cases){
  const input=fs.readFileSync(path.join(dir,c.id+'-2x.png')),times=[],cpus=[];let jpg;
  for(let i=0;i<3;i++){const start=performance.now(),cpu=process.cpuUsage();jpg=await exporter(input,{grain:c.kind==='match'});times.push(performance.now()-start);const used=process.cpuUsage(cpu);cpus.push((used.user+used.system)/1000);}
  const expected=fs.readFileSync(path.join(dir,c.id+(mode==='before'?'-before.jpg':'-q97-444.jpg')));
  const pixels=await sharp(jpg).removeAlpha().raw().toBuffer(),reference=await sharp(path.join(dir,c.id+'-reference.png')).removeAlpha().raw().toBuffer();
  const decoded=await sharp(expected).removeAlpha().raw().toBuffer(),metadata=await sharp(jpg).metadata();
  if(!pixels.equals(decoded))throw Error('Actual exporter differs from measured candidate: '+c.id);
  if(mode==='before'&&!jpg.equals(expected))throw Error('Baseline bytes mismatch: '+c.id);
  if(metadata.width!==1080||metadata.height!==1350||metadata.chromaSubsampling!=='4:4:4'||(mode==='after'&&!metadata.icc)||metadata.exif)throw Error('Output metadata regression');
  if(mode==='after')fs.writeFileSync(path.join(dir,c.id+'-after.jpg'),jpg);
  rows.push({id:c.id,kind:c.kind,bytes:jpg.length,medianMs:median(times),medianCpuMs:median(cpus),candidatePixelsIdentical:true,iccBytes:metadata.icc?.length??0,...compareRgb(reference,pixels,1080,1350)});
 }
 console.log(JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS,rows}));
}
