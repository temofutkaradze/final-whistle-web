// Private synthetic samples only. No API, database, Telegram or source photos.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {fictionalTable} from '../tests/standings-fixture.ts';
import {createStandingsService} from '../src/lib/news/standings.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'preview-images','standings');await mkdir(out,{recursive:true});
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const secret=randomUUID();
const child=spawn(process.execPath,[path.join(root,'render/render-server.js')],{cwd:root,env:{...process.env,RENDER_PORT:String(port),NEWS_RENDER_SECRET:secret,DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused'},stdio:['ignore','pipe','pipe']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let startup='';const collect=b=>{startup=(startup+b.toString()).slice(-4000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
const auth={'content-type':'application/json','x-news-render-secret':secret};
try{
  const deadline=Date.now()+45_000;
  for(;;){if(child.exitCode!==null)throw Error('Sample renderer exited: '+startup);try{if((await fetch(`http://127.0.0.1:${port}/news-health`,{headers:auth,signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(Date.now()>deadline)throw Error('Sample renderer startup timed out');await wait(200);}
  const background=await sharp(Buffer.from(`<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#182a41"/><stop offset="1" stop-color="#173d2f"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#b)"/><path d="M0 700L1080 700M540 700V1350M80 850H1000V1280H80Z" stroke="#a0c1ad" stroke-width="3" fill="none"/><circle cx="540" cy="1065" r="140" stroke="#a0c1ad" stroke-width="3" fill="none"/><text x="540" y="200" text-anchor="middle" font-family="sans-serif" font-size="45" fill="white">FICTIONAL STANDINGS DEMO</text><text x="540" y="265" text-anchor="middle" font-family="sans-serif" font-size="25" fill="white">Synthetic background - No real football results</text></svg>`)).png().toBuffer();
  const files=[];
  for(const [count,leagueId] of [[2,39],[3,140],[4,135]]){
    const job=await createStandingsService({id:'local-fixture-only',getCurrentTable:()=>fictionalTable(leagueId)})(leagueId,Array.from({length:count},(_,i)=>i+1));
    const response=await fetch(`http://127.0.0.1:${port}/render-news`,{method:'POST',headers:auth,body:JSON.stringify({job,background:background.toString('base64'),circle:null}),signal:AbortSignal.timeout(90_000)});
    if(!response.ok)throw Error('Sample render failed');const result=await response.json();
    const source=path.resolve(result.jpg_path);if(path.dirname(source)!==path.join(root,'render/output')||!/^news_[a-f0-9-]+\.jpg$/.test(path.basename(source)))throw Error('Unexpected sample path');
    const name=`fictional-${count}-rows.jpg`;await copyFile(source,path.join(out,name));files.push(name);
  }
  const tiles=await Promise.all(files.map(async(name,i)=>({input:await sharp(await readFile(path.join(out,name))).resize(360,450).png().toBuffer(),left:i*360,top:40})));
  const labels=Buffer.from(`<svg width="1080" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="40" fill="#101419"/>${files.map((_,i)=>`<text x="${i*360+20}" y="27" font-family="sans-serif" font-size="20" fill="white">FICTIONAL - ${i+2} rows</text>`).join('')}</svg>`);
  await sharp({create:{width:1080,height:490,channels:3,background:'#101419'}}).composite([{input:labels,left:0,top:0},...tiles]).jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(path.join(out,'contact-sheet.jpg'));
  await writeFile(path.join(out,'README.txt'),'FICTIONAL DATA ONLY. Synthetic background and placeholder crests. 2-row Premier League palette; 3-row La Liga palette; 4-row Serie A palette. No real standings, photos or live API were used.\n');
  console.log('Private samples saved: '+out);
}finally{if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([exit,wait(5000)]);}}
