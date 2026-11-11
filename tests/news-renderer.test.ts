import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {existsSync} from 'node:fs';
import {standingsTransition} from '../src/lib/news/standings';
// @ts-expect-error Runtime JavaScript module has no declaration file.
import {createNewsHandler} from '../scripts/lib/news-core.mjs';
import {vi} from 'vitest';
import {fictionalTable} from './standings-fixture';
import {createStandingsService} from '../src/lib/news/standings';
import { buildJob } from '@/lib/news/parse';
import { newsPreviewImages } from '@/lib/news/preview';

const root=resolve(__dirname,'..');
const secret='isolated-news-render-test-key';
let child:ChildProcess;
let port:number;
let background:Buffer;
let secondary:Buffer;
const outputs=new Set<string>();
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const auth={'content-type':'application/json','x-news-render-secret':secret};
async function post(body:unknown){return fetch(`http://127.0.0.1:${port}/render-news`,{method:'POST',headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});}

beforeAll(async()=>{
  ({background,secondary}=await newsPreviewImages());
  port=await new Promise<number>((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>res(p));});});
  child=spawn(process.execPath,[resolve(root,'render/render-server.js')],{cwd:root,env:{...process.env,RENDER_PORT:String(port),NEWS_RENDER_SECRET:secret,DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused'}});
  let log='';child.stdout?.on('data',d=>{log+=d;});child.stderr?.on('data',d=>{log+=d;});
  const started=Date.now();
  while(true){
    if(child.exitCode!==null)throw new Error('Isolated test renderer exited: '+log);
    try{const r=await fetch(`http://127.0.0.1:${port}/news-health`,{headers:auth,signal:AbortSignal.timeout(1000)});if(r.ok)break;}catch{}
    if(Date.now()-started>45_000)throw new Error('Isolated renderer startup timed out: '+log);
    await pause(150);
  }
},60_000);

afterAll(async()=>{
  if(child && child.exitCode===null){const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill();await Promise.race([exited,pause(3000)]);}
  for(const file of outputs)if(dirname(file)===resolve(root,'render/output')&&/^news_[a-f\d-]+\.jpg$/i.test(basename(file)))await unlink(file).catch(()=>{});
});

describe('News actual shared Chromium and Sharp pipeline',()=>{
  it('authenticates renderer protocol 2 and rejects an incorrect key',async()=>{
    const good=await fetch(`http://127.0.0.1:${port}/news-health`,{headers:auth});expect(await good.json()).toEqual({service:'final-whistle-news',protocolVersion:2});
    const bad=await fetch(`http://127.0.0.1:${port}/news-health`,{headers:{'x-news-render-secret':'wrong'}});expect(bad.status).toBe(401);
  });
  for(const layout of ['single','left','right','breaking'] as const)it('renders '+layout+' as a real 1080 x 1350 JPG',async()=>{
    const job=buildJob(layout==='breaking'?'BREAKING | A NEW CHAPTER':'FINAL WHISTLE | THE NEXT CHAPTER STARTS *HERE*',['left','right'].includes(layout),layout);
    const response=await post({job,background:background.toString('base64'),circle:['left','right'].includes(layout)?secondary.toString('base64'):null});
    expect(response.status).toBe(200);
    const result=await response.json();expect(typeof result.jpg_path).toBe('string');outputs.add(result.jpg_path);
    expect(dirname(result.jpg_path)).toBe(resolve(root,'render/output'));
    const bytes=await readFile(result.jpg_path);expect(await sharp(bytes).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
    const metadata=await sharp(bytes).metadata();expect(metadata.chromaSubsampling).toBe('4:4:4');expect(metadata.icc?.length).toBeGreaterThan(0);expect(metadata.exif).toBeUndefined();
    const {data,info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
    const bottom=data.subarray((info.height-100)*info.width*info.channels);
    expect(bottom.some(value=>value>100)).toBe(true);
  },90_000);
  for(const count of [1,2,3,4,20,36])it('renders fictional standings with '+count+' rows using the actual News pipeline',async()=>{
    const job=await createStandingsService({id:'test-only',getCurrentTable:()=>fictionalTable(count===36?2:39)})(count===36?2:39,Array.from({length:count},(_,i)=>i+1));
    const response=await post({job,background:background.toString('base64'),circle:null});
    expect(response.status).toBe(200);const result=await response.json();outputs.add(result.jpg_path);
    const bytes=await readFile(result.jpg_path);const meta=await sharp(bytes).metadata();
    expect(meta).toMatchObject({width:1080,height:1350,format:'jpeg',chromaSubsampling:'4:4:4'});expect(meta.icc?.length).toBeGreaterThan(0);
  },90_000);
  it('renders UCL display rows 28-31 with official ranks 28,29,29,31',async()=>{
    const table=await fictionalTable(2);table.rows[28].teamId='1899';table.rows[29].teamId='721';table.rows[29].position=29;
    const job=await createStandingsService({id:'fictional-only',getCurrentTable:async()=>table})(2,[28,29,30,31]);
    expect(job.standings.rows.map(r=>r.position)).toEqual([28,29,29,31]);
    const response=await post({job,background:background.toString('base64'),circle:null});expect(response.status).toBe(200);
    const result=await response.json();outputs.add(result.jpg_path);expect(await sharp(await readFile(result.jpg_path)).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
  },90_000);
  it('rejects unsafe/non-raster standings crests before Chromium',async()=>{
    const job=await createStandingsService({id:'test',getCurrentTable:()=>fictionalTable()})(39,[1,2]);
    job.standings.rows[0].crest=Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
    expect((await post({job,background:background.toString('base64'),circle:null})).status).toBe(500);
  });
  for(const [width,height] of [[600,900],[800,800],[1200,675]])it('fills the canvas without bars for '+width+'x'+height,async()=>{
    const photo=await sharp({create:{width,height,channels:3,background:'#4e92ac'}}).jpeg().toBuffer();
    const job=await createStandingsService({id:'fixture',getCurrentTable:()=>fictionalTable()})(39,[1,2,3]);
    const r=await post({job,background:photo.toString('base64'),circle:null});expect(r.status).toBe(200);const out=await r.json();outputs.add(out.jpg_path);
    const {data,info}=await sharp(await readFile(out.jpg_path)).raw().toBuffer({resolveWithObject:true});expect(info).toMatchObject({width:1080,height:1350});
    // The single cover-fitted source reaches all edges, including former margins.
    for(const [x,y] of [[5,5],[1074,5],[5,600],[1074,600]]){const i=(y*info.width+x)*info.channels;expect(data[i+1]).toBeGreaterThan(50);expect(data[i+2]).toBeGreaterThan(70);}
  },90_000);
  it('applies explicit horizontal and vertical cover positions to actual JPEG pixels',async()=>{
    const job=await createStandingsService({id:'fixture',getCurrentTable:()=>fictionalTable()})(39,[1,2,3]);
    const horizontal=await sharp({create:{width:1200,height:600,channels:3,background:'#00aa00'}}).composite([
      {input:await sharp({create:{width:600,height:600,channels:3,background:'#ee2020'}}).png().toBuffer(),left:0,top:0},
      {input:await sharp({create:{width:600,height:600,channels:3,background:'#2030ee'}}).png().toBuffer(),left:600,top:0},
    ]).png().toBuffer();
    const vertical=await sharp({create:{width:400,height:1200,channels:3,background:'#00aa00'}}).composite([
      {input:await sharp({create:{width:400,height:600,channels:3,background:'#ee2020'}}).png().toBuffer(),left:0,top:0},
      {input:await sharp({create:{width:400,height:600,channels:3,background:'#2030ee'}}).png().toBuffer(),left:0,top:600},
    ]).png().toBuffer();
    for(const [photo,composition,channel] of [
      [horizontal,{backgroundX:0},0],[horizontal,{backgroundX:100},2],
      [vertical,{backgroundY:0},0],[vertical,{backgroundY:100},2],
    ] as const){
      const response=await post({job:{...job,composition},background:photo.toString('base64'),circle:null});expect(response.status).toBe(200);
      const result=await response.json();outputs.add(result.jpg_path);
      const {data}=await sharp(await readFile(result.jpg_path)).extract({left:10,top:10,width:1,height:1}).removeAlpha().raw().toBuffer({resolveWithObject:true});
      expect(data[channel]).toBeGreaterThan(200);expect(data[channel===0?2:0]).toBeLessThan(70);
    }
    expect((await post({job:{...job,composition:{backgroundX:'0%;transform:scale(10)'}},background:horizontal.toString('base64'),circle:null})).status).toBe(500);
  },90_000);
  const originalPath=process.env.STANDINGS_TEST_PHOTO??resolve(root,'tests/fixtures/photos/IMG_8334.JPG');
  (existsSync(originalPath)?it:it.skip)('accepts unmodified IMG_8334.JPG document through the authorized handler and real renderer',async()=>{
    const photo=await readFile(originalPath);expect(await sharp(photo).metadata()).toMatchObject({format:'jpeg'});
    const state:any={botToken:'fictional',telegramChatId:'42',pending:null,lastUpdateId:null,defaultTemplateRef:'single'};
    const settings={findUnique:async()=>structuredClone(state),updateMany:async({where,data}:any)=>{if(where.OR&&state.lastUpdateId!==null&&state.lastUpdateId>=where.OR[1].lastUpdateId.lt)return {count:0};Object.assign(state,data);return {count:1};}};
    const sendDocument=vi.fn(async()=>{});
    const handle=createNewsHandler({prisma:{newsSettings:settings},tg:{sendMessage:async()=>({ok:true}),sendDocument},ownerId:'test',connectionToken:'fictional',download:async()=>photo,cleanup:async()=>{},standings:createStandingsService({id:'fictional',getCurrentTable:()=>fictionalTable()}),render:async(job:unknown,bytes:Buffer)=>{
      expect(bytes).toEqual(photo);const r=await post({job,background:bytes.toString('base64'),circle:null});expect(r.status).toBe(200);const out=await r.json();outputs.add(out.jpg_path);expect(await sharp(await readFile(out.jpg_path)).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});return out.jpg_path;
    }});
    const message={document:{file_id:'original-jpg',file_name:'IMG_8334.JPG',mime_type:'application/octet-stream'},caption:'Premier League 1 2 3',chat:{id:42,type:'private'},from:{id:42}};
    expect(standingsTransition(message,null,Date.now())).toMatchObject({background:'original-jpg'});
    const update={update_id:1,message};await handle(update);await handle(update);expect(sendDocument).toHaveBeenCalledTimes(1);
  },90_000);
  it('rejects a circle layout without its secondary image',async()=>{
    const response=await post({job:buildJob('Author | News',true,'left'),background:background.toString('base64'),circle:null});expect(response.status).toBe(500);
  });
});
