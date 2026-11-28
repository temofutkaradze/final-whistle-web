// Sequential, isolated real-browser comparison. No server, DB or Telegram network calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {buildHtml} from '../../src/lib/news/html.ts';
import {buildOriginalJob} from '../../src/lib/news/parse.ts';
import {renderNewsPost} from '../../src/lib/news/render.ts';
import {makeTelegram} from '../lib/telegram.mjs';
const require=createRequire(import.meta.url),{alignBranding}=require('../../render/branding-position.js');
const createRenderer=require('../../render/news-renderer.js');
const available=()=>Number(execFileSync('powershell.exe',['-NoProfile','-Command','(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'],{encoding:'utf8',windowsHide:true}).trim())/1024;
const free=available();if(free<448)throw Error(`Safety threshold: only ${free.toFixed(1)} MiB free`);
if(!process.argv[2])throw Error('Pass an authorized local photograph');
const source=await fs.readFile(process.argv[2]),normalized=await sharp(source).rotate().png().toBuffer();
const out=path.resolve('storage/optimization-verification-'+Date.now());await fs.mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const pixelHash=async b=>hash(await sharp(b).ensureAlpha().raw().toBuffer());
const runtime=require('../../render/runtime/browser.js')({chromium});
const browser=await runtime.getBrowser();
const render=createRenderer({getBrowser:async()=>browser,captureHiRes:page=>page.screenshot({type:'png',scale:'device',animations:'disabled'}),makeJpeg:()=>{throw Error('Unexpected JPEG conversion');},sharp,outputDir:path.resolve('render/output')});
const base=buildOriginalJob('AUTHOR | SAME *PHOTO* AND HEADLINE',false);
const jobs=[base,...['left','right'].map(layout=>({...base,layout})),... [false,true].map(breakingText=>({...base,layout:'breaking',breakingText})),
  ...['headline-subtitle','large-headline','news-red','did-you-know'].flatMap(template=>[1,2].filter(v=>v===1||['news-red','did-you-know'].includes(template)).map(version=>({...base,editorial:{template,version,headline:'SAME *PHOTO* AND HEADLINE',subtitle:'Supporting text'}}))),
  ...[128,160].map(bottomOffset=>({...base,editorial:{template:'large-headline',layoutMode:'manual',bottomOffset,headline:'SAME *PHOTO*\nAND HEADLINE',subtitle:''}})),
  {...base,brandingOnly:true,branding:true}];
const rows=[];
try{
  for(const [i,job]of jobs.entries()){
    if(available()<128)throw Error('Stopped: insufficient remaining system memory');
    const name=job.brandingOnly?'branding':job.editorial?job.editorial.template+'-'+(job.editorial.layoutMode==='manual'?'manual-'+job.editorial.bottomOffset:job.editorial.version):job.layout==='breaking'?'breaking-'+job.breakingText:job.layout;
    const circle=['left','right'].includes(job.layout)?normalized:null;
    let width=2160,height=2700,html;
    if(job.brandingOnly){const m=await sharp(normalized).metadata(),scale=Math.max(1,Math.min(2160/m.width,2700/m.height));width=Math.round(m.width*scale);height=Math.round(m.height*scale);html=`<html><body style="margin:0;overflow:hidden;width:${width}px;height:${height}px"><img style="display:block;width:${width}px;height:${height}px" src="data:image/png;base64,${normalized.toString('base64')}"></body></html>`;}
    else html=buildHtml(job,normalized,circle);
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    let before;
    try{const page=await context.newPage();await page.route('**/*',r=>/^(data:|about:)/.test(r.request().url())?r.continue():r.abort());await page.setContent(html);if(job.brandingOnly)await page.evaluate(()=>document.images[0].decode());else await page.waitForFunction(()=>document.documentElement.getAttribute('data-ready')==='1');if(job.branding)await alignBranding(page);before=await page.screenshot({type:'png',scale:'device',animations:'disabled'});}finally{await context.close();}
    const start=performance.now();const result=await render(job,source,circle);const ms=performance.now()-start;
    try{
      const after=await fs.readFile(result.png_path),meta=await sharp(after).metadata();
      const equal=(await pixelHash(before))===(await pixelHash(after));
      if(!equal)throw Error(`Pixel mismatch: ${name}`);
      // Exercise the actual output validator and multipart delivery, intercepting only HTTP.
      process.env.NEWS_RENDER_SECRET='isolated-verification';const savedFetch=globalThis.fetch;
      try{
        globalThis.fetch=async()=>Response.json(result);
        const file=await renderNewsPost(job,source,circle);
        globalThis.fetch=async(url,options)=>{if(!String(url).endsWith('/sendDocument'))throw Error('Unexpected endpoint');const f=options.body.get('document');if(f.type!=='image/png'||hash(Buffer.from(await f.arrayBuffer()))!==hash(after))throw Error('Document bytes changed');return Response.json({ok:true});};
        await makeTelegram('test-only').sendDocument('test',file,'','news-post.png');
      }finally{globalThis.fetch=savedFetch;}
      await fs.writeFile(path.join(out,name+'.png'),after);
      rows.push({name,width:meta.width,height:meta.height,format:meta.format,bytes:after.length,pixelsIdentical:true,documentBytesIdentical:true,renderMs:Math.round(ms)});
      console.log(JSON.stringify(rows.at(-1)));
    }finally{await fs.unlink(result.png_path);}
  }
}finally{await runtime.resetBrowser();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(rows,null,2));}
console.log('Results: '+out);
