// Isolated offline quality experiment. Does not load .env, a database, or a bot.
// Production files are compiled IN MEMORY solely to expose lossless captures and
// vary capture scale; no runtime quality switches are added to the HTTP service.
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import http from 'node:http';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {sampleMatchFields} from '../../src/lib/sample-match.ts';
import {buildJob} from '../../src/lib/news/parse.ts';
import {fixtures} from './fixtures.mjs';
import {compareRgb,median} from './metrics.mjs';

const root=path.resolve('storage/quality'),smoke=process.argv.includes('--smoke');
// Pin the original implementation even after the selected exporter is changed.
const baselineRef='12c09a6';
const baselineSource=file=>execFileSync('git',['show',`${baselineRef}:${file}`],{encoding:'utf8'});
const output=path.join(root,smoke?'smoke':'results');fs.mkdirSync(output,{recursive:true});
if(!smoke&&!process.argv.includes('--resume')&&fs.existsSync(path.join(output,'results.json')))throw Error('Results already exist: use --resume or a fresh isolated checkout; refusing to overwrite evidence');
const marker=path.join(output,'monitor-stop');if(fs.existsSync(marker))fs.unlinkSync(marker);
const monitor=process.platform==='win32'?spawn('python',['-B','scripts/quality/monitor.py',String(process.pid),output],{stdio:['ignore','pipe','pipe']}):null;
let monitorError='',monitorFailed=false;monitor?.stderr.on('data',b=>monitorError+=b);monitor?.on('error',()=>{monitorFailed=true;monitorError='Process sampler unavailable; RAM measurements are unverified.';});
const phase=name=>fs.writeFileSync(path.join(output,'phase.json'),JSON.stringify({phase:name}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const resume=process.argv.includes('--resume')&&fs.existsSync(path.join(output,'results.json'))?JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8')):null;
const rows=resume?.rows??[],captures=resume?.captures??[],fontCache=new Map(),failures=[];
const matchLayouts=['classic','panel','frame','stripe'],newsLayouts=['single','left','right','breaking'];
const secret='local-quality-fixtures-only';process.env.NEWS_RENDER_SECRET=secret;
process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused';
let grain;
// Seeded Gaussian grain freezes the existing sigma=5 effect for fair comparisons.
let seed=123456789;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
const noise=Buffer.alloc(1080*1350*3);for(let i=0;i<noise.length;i++)noise[i]=Math.max(0,Math.min(255,Math.round(128+5*Math.sqrt(-2*Math.log(rnd()))*Math.cos(2*Math.PI*rnd()))));
grain=await sharp(noise,{raw:{width:1080,height:1350,channels:3}}).png().toBuffer();
function fixedSharp(input,...args){return input?.create?.noise?sharp(grain):sharp(input,...args);}Object.assign(fixedSharp,sharp);
const browser=await chromium.launch();
const cpu=()=>process.cpuUsage(),cpuMs=start=>{const d=process.cpuUsage(start);return (d.user+d.system)/1000;};
let networkFrozen=false;
async function renderer(scale){
 const state={contexts:[],server:null,ready:false,lastPng:null,logs:[]};
 const browserProxy=new Proxy(browser,{get(target,key){
  if(key==='close')return async()=>{};
  if(key==='newContext')return async options=>{
   const isNews=options.viewport.width===2160;
   const context=await target.newContext({...options,deviceScaleFactor:isNews?scale/2:scale});state.contexts.push(context);
   // Cache public font responses once. During measurements no external requests
   // are allowed, and missing fonts fail the benchmark rather than use fallbacks.
   await context.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//,async route=>{
    const url=route.request().url();let cached=fontCache.get(url);
    if(!cached){
     if(networkFrozen){failures.push('Uncached font during measurement');return route.abort();}
     try{const res=await route.fetch({timeout:20000});if(!res.ok())throw Error('Font HTTP failure');cached={body:await res.body(),headers:res.headers(),status:res.status()};fontCache.set(url,cached);}catch{failures.push('Font download unavailable');return route.abort();}
    }
    return route.fulfill(cached);
   });
   return context;
  };
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 const filename=path.resolve('render/render-server.js'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));const original=mod.require.bind(mod);
 const log={log:(...a)=>{const s=a.join(' ');state.logs.push(s);if(/Warm-up (done|skipped)/.test(s))state.ready=true;},warn:(...a)=>state.logs.push(a.join(' ')),error:(...a)=>state.logs.push(a.join(' '))};
 mod.require=name=>{
  if(name==='playwright')return {chromium:{launch:async()=>browserProxy}};
  if(name==='sharp')return fixedSharp;
  if(name==='http')return {...http,createServer:handler=>{const s=http.createServer(handler),listen=s.listen.bind(s);s.listen=(_port,host,cb)=>listen(0,host,cb);state.server=s;return s;}};
  if(name==='./news-renderer.js'){
   const file=path.resolve('render/news-renderer.js'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
   m._compile(baselineSource('render/news-renderer.js').replace('meta.width !== 2160 || meta.height !== 2700',`meta.width !== ${1080*scale} || meta.height !== ${1350*scale}`),file);return m.exports;
  }
  return original(name);
 };
 globalThis.__qualityState=state;globalThis.__qualityLog=log;
 let source=baselineSource('render/render-server.js').replace('FINAL_WIDTH * 2',`FINAL_WIDTH * ${scale}`).replace('FINAL_HEIGHT * 2',`FINAL_HEIGHT * ${scale}`);
 source=source.replace('async function makeJpeg(pngBuffer, { grain = true } = {}) {','async function makeJpeg(pngBuffer, { grain = true } = {}) { state.lastPng=Buffer.from(pngBuffer);');
 source+='\nmodule.exports={drainAndClose};';
 const beforeSignal={SIGINT:process.listeners('SIGINT'),SIGTERM:process.listeners('SIGTERM')};
 mod._compile('const state=globalThis.__qualityState,console=globalThis.__qualityLog;\n'+source,filename);
 const started=Date.now();while(!state.ready){if(Date.now()-started>90000)throw Error('Benchmark renderer warmup failed');await sleep(100);}
 state.port=state.server.address().port;
 state.close=async()=>{await mod.exports.drainAndClose();for(const ctx of state.contexts)await ctx.close().catch(()=>{});for(const event of ['SIGINT','SIGTERM'])for(const listener of process.listeners(event))if(!beforeSignal[event].includes(listener))process.removeListener(event,listener);fs.writeFileSync(path.join(output,`renderer-${scale}x.log`),state.logs.join('\n'));};
 return state;
}
async function render(state,kind,layout,fixture){
 const body=kind==='match'?{...sampleMatchFields(),fixture_id:`quality_${fixture.name}_${layout}`,page_name:'FINAL\nWHISTLE',template:layout,background_data_uri:`data:image/${fixture.metadata.format};base64,${fixture.bytes.toString('base64')}`}:{job:buildJob(layout==='breaking'?'BREAKING | THE FINAL WHISTLE':'TEST PLAYER | ACCURATE *NUMBERS* AND FINE DETAILS',['left','right'].includes(layout),layout),background:fixture.bytes.toString('base64'),circle:['left','right'].includes(layout)?fixture.bytes.toString('base64'):null};
 const started=performance.now(),usage=cpu();
 const res=await fetch(`http://127.0.0.1:${state.port}/${kind==='match'?'render':'render-news'}`,{method:'POST',headers:{'content-type':'application/json','x-news-render-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const result=await res.json();if(!res.ok)throw Error(`Isolated ${kind}/${layout} render HTTP ${res.status}: ${JSON.stringify(result)}`);
 return {png:state.lastPng,jpg:fs.readFileSync(result.jpg_path),wallMs:performance.now()-started,nodeCpuMs:cpuMs(usage)};
}
async function pixels(png,kernel='lanczos3',addGrain=false){let p=sharp(png).flatten({background:'#000000'}).resize(1080,1350,{fit:'fill',kernel}).toColourspace('srgb');if(addGrain)p=p.composite([{input:grain,blend:'soft-light'}]);return p.removeAlpha().raw().toBuffer();}
async function encode(raw,quality,chroma,icc=false){let p=sharp(raw,{raw:{width:1080,height:1350,channels:3}});if(icc)p=p.withIccProfile('srgb');return p.jpeg({quality,chromaSubsampling:chroma}).toBuffer();}
async function candidate(id,raw,reference,config){
 phase(`encode-${config.label}`);const times=[],cpus=[];let jpg;
 // Repeated encoder-only measurements exclude decode, metric calculation and IO.
 for(let repeat=0;repeat<(smoke?1:3);repeat++){const start=performance.now(),usage=cpu();jpg=await encode(raw,config.quality,config.chroma,config.icc);times.push(performance.now()-start);cpus.push(cpuMs(usage));}
 const decoded=await sharp(jpg).removeAlpha().raw().toBuffer(),metrics=compareRgb(reference,decoded,1080,1350);
 const record={id,...config,bytes:jpg.length,encodeMedianMs:median(times),nodeCpuMedianMs:median(cpus),...metrics};rows.push(record);fs.writeFileSync(path.join(output,id+'-'+config.label+'.jpg'),jpg);return record;
}
try{
 const allFixtures=await fixtures(root),selected=smoke?allFixtures.slice(0,1):allFixtures.filter(f=>f.name!=='photo-high');
 const layouts=smoke?[['match','classic'],['news','left']]:[...matchLayouts.map(l=>['match',l]),...newsLayouts.map(l=>['news',l])];
 for(const scale of smoke?[2]:[2,1,3]){
  phase(`warmup-${scale}x`);networkFrozen=false;const state=await renderer(scale);
  try{
   for(const [kind,layout] of layouts)await render(state,kind,layout,selected[0]);
   if(failures.length)throw Error('Fonts unavailable: refuse mismatched typography benchmark');networkFrozen=true;
   for(const fixture of selected)for(const [kind,layout] of layouts){
    if(scale!==2&&!['chart-portrait','photo-6mp'].includes(fixture.name))continue;
    if(scale===3&&!['classic','panel','left','breaking'].includes(layout))continue;
    const id=`${fixture.name}-${kind}-${layout}`;phase(`render-${scale}x-${kind}`);
    if(captures.some(c=>c.id===id&&c.scale===scale))continue;
    const samples=[];let result;for(let repeat=0;repeat<(smoke?1:2);repeat++){result=await render(state,kind,layout,fixture);samples.push({wallMs:result.wallMs,nodeCpuMs:result.nodeCpuMs});}
    fs.writeFileSync(path.join(output,`${id}-${scale}x.png`),result.png);
    const raw=await pixels(result.png),original=await pixels(result.png,'lanczos3',kind==='match');
    const capture={id,kind,layout,fixture:fixture.name,scale,renderMedianMs:median(samples.map(r=>r.wallMs)),nodeCpuMedianMs:median(samples.map(r=>r.nodeCpuMs)),samples};captures.push(capture);
    if(scale===2){
     fs.writeFileSync(path.join(output,`${id}-before.jpg`),result.jpg);
     fs.writeFileSync(path.join(output,`${id}-reference.png`),await sharp(raw,{raw:{width:1080,height:1350,channels:3}}).png().toBuffer());
     for(const quality of smoke?[93,95]:[93,95,97,100])for(const chroma of ['4:4:4','4:2:0'])await candidate(id,raw,raw,{label:`q${quality}-${chroma.replaceAll(':','')}`,quality,chroma,icc:false});
     await candidate(id,raw,raw,{label:'q95-444-icc',quality:95,chroma:'4:4:4',icc:true});
     if(kind==='match'){
      const baseline=await encode(original,93,'4:4:4');if(!baseline.equals(result.jpg))throw Error('Baseline encoder does not reproduce production bytes');
      await candidate(id,original,raw,{label:'grain-q93-444',quality:93,chroma:'4:4:4',icc:false});
      await candidate(id,original,raw,{label:'grain-q95-444',quality:95,chroma:'4:4:4',icc:false});
     }
     for(const kernel of smoke?[]:['lanczos2','mitchell','mks2021']){const start=performance.now(),usage=cpu(),other=await pixels(result.png,kernel);const cost={resizeMs:performance.now()-start,resizeCpuMs:cpuMs(usage)};await candidate(id,other,raw,{label:`${kernel}-q95-444`,quality:95,chroma:'4:4:4',icc:false,kernel,...cost});}
    }else{const reference=await sharp(path.join(output,`${id}-reference.png`)).removeAlpha().raw().toBuffer();await candidate(id,raw,reference,{label:`${scale}x-q95-444`,quality:95,chroma:'4:4:4',icc:false});}
    console.log(JSON.stringify(capture));
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({environment:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,sharp:sharp.versions,browser:browser.version()},fixtures:allFixtures.map(f=>({name:f.name,description:f.description,width:f.metadata.width,height:f.metadata.height})),fontResponses:fontCache.size,failures,captures,rows},null,2));
   }
  }finally{await state.close();}
 }
}finally{
 await browser.close();fs.writeFileSync(marker,'done');
 if(monitor&&!monitorFailed){await new Promise(resolve=>{if(monitor.exitCode!==null)resolve();else monitor.once('exit',resolve);});}if(monitorError)fs.writeFileSync(path.join(output,'monitor-error.txt'),monitorError);
}
