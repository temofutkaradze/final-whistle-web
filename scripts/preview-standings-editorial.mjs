// Private visual review only: fictional tables, no API key, database or Telegram.
// node scripts/preview-standings-editorial.mjs --photo <private JPG> [--before-ref <commit>]
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {downloadPublicResource} from '../render/security.js';
import {fictionalTable} from '../tests/standings-fixture.ts';
import {createStandingsService} from '../src/lib/news/standings.ts';
import {clubDisplayName} from '../src/lib/news/club-display-names.ts';
import {standingsComposition} from '../src/lib/news/standings-html.ts';
import {normalizeStandingsCrest} from '../render/standings-artwork.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const option=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const photo=option('--photo');if(!photo)throw Error('Supply --photo with a private local image; it will not be uploaded.');
const review=option('--review-dir'),only=option('--only');
if(review&&!/^[0-9TZ-]+$/.test(review))throw Error('review-dir must be a generated review folder name');
const out=path.join(root,'preview-images','standings-editorial',review??new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});const cache=path.join(root,'preview-images','standings-editorial','artwork-cache');await mkdir(cache,{recursive:true});
const original=await readFile(path.resolve(photo));
const palette=['#44779c','#ad363d','#d3a044','#34644e','#4d449a','#508e99'];
async function crest(id,index=0){
  const file=path.join(cache,id+'.png');if(existsSync(file))return readFile(file);
  try{const r=await downloadPublicResource('https://crests.football-data.org/'+id+'.png',{maxBytes:512*1024,timeoutMs:6000});const b=await sharp(r.body,{limitInputPixels:2048*2048}).resize({width:128,height:128,fit:'inside'}).png().toBuffer();await writeFile(file,b);return b;}catch{
    return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="110"><path d="M8 8H82V65Q78 92 45 103Q12 92 8 65Z" fill="${palette[index%6]}" stroke="white" stroke-width="3"/><text x="45" y="60" text-anchor="middle" fill="white" font-family="sans-serif" font-size="28">${index+1}</text></svg>`)).png().toBuffer();
  }
}
const clubs={
  39:[[57,'Arsenal FC'],[397,'Brighton & Hove Albion FC'],[65,'Manchester City FC'],[64,'Liverpool FC'],[61,'Chelsea FC'],[66,'Manchester United FC']],
  140:[[81,'FC Barcelona'],[86,'Real Madrid CF'],[78,'Club Atlético de Madrid'],[90,'Real Betis Balompié'],[95,'Valencia CF'],[559,'Sevilla FC']],
  135:[[108,'FC Internazionale Milano'],[98,'AC Milan'],[109,'Juventus FC'],[100,'AS Roma'],[99,'ACF Fiorentina'],[110,'SS Lazio']],
  78:[[5,'FC Bayern München'],[4,'Borussia Dortmund'],[721,'RB Leipzig'],[19,'Eintracht Frankfurt'],[10,'VfB Stuttgart'],[3,'Bayer 04 Leverkusen']],
  61:[[524,'Paris Saint-Germain FC'],[516,'Olympique de Marseille'],[523,'Olympique Lyonnais'],[548,'AS Monaco FC'],[521,'Lille OSC'],[529,'Stade Rennais FC']],
  2:[[57,'Arsenal FC'],[86,'Real Madrid CF'],[5,'FC Bayern München'],[108,'FC Internazionale Milano'],[81,'FC Barcelona'],[65,'Manchester City FC']],
};
async function table(league){
  const t=await fictionalTable(league);t.source='FICTIONAL DESIGN PREVIEW - NOT REAL STANDINGS';
  t.rows.forEach((r,i)=>r.teamId=String(10000+i));
  const emblem=path.join(root,'render/assets/leagues/symbols',league+'.png');
  t.leagueLogo=(existsSync(emblem)?await readFile(emblem):await crest('PL')).toString('base64');
  for(const [i,[id,name]] of clubs[league].entries()){Object.assign(t.rows[i],{teamId:String(id),name,crest:(await crest(String(id),i)).toString('base64'),points:31-i*3,played:12,goalDifference:18-i*4});}
  return t;
}
const source=await sharp(original).rotate().png().toBuffer();
async function canvas(width,height){
  // Explicit 50% X / 22% Y crops make aspect-ratio test inputs. These do not
  // detect subjects. PNG intermediates avoid repeated JPEG compression.
  const meta=await sharp(source).metadata(),ratio=width/height;
  const w=Math.min(meta.width,Math.floor(meta.height*ratio));
  const h=Math.min(meta.height,Math.floor(meta.width/ratio));
  return sharp(source).extract({left:Math.floor((meta.width-w)*.5),top:Math.floor((meta.height-h)*.22),width:w,height:h}).resize(width,height).png().toBuffer();
}
const backgrounds={original,portrait:original,square:await canvas(1200,1200),landscape:await canvas(1600,900),exif:await sharp(source).rotate(-90).jpeg({quality:97}).withMetadata({orientation:6}).toBuffer()};
const scenarios=[
  ['01-premier-original-3',39,3,'original'],['02-premier-original-4',39,4,'original'],
  ['03-laliga-original-3',140,3,'original'],['04-serie-a-original-3',135,3,'original'],
  ['05-bundesliga-original-3',78,3,'original'],['06-ligue1-original-3',61,3,'original'],
  ['07-champions-original-3',2,3,'original'],['08-premier-square-3',39,3,'square'],
  ['09-laliga-landscape-3',140,3,'landscape'],['10-premier-long-names-3',39,3,'original'],
  ['11-champions-tied-4',2,4,'original'],['12-bundesliga-exif-3',78,3,'exif'],
  ['13-ligue1-original-6',61,6,'original'],['14-champions-full-36',2,36,'original'],
];
const composition=standingsComposition(Object.fromEntries([['--background-x','backgroundX'],['--background-y','backgroundY'],['--panel-offset','panelOffset']].filter(([flag])=>option(flag)!==null).map(([flag,key])=>[key,Number(option(flag))])));
let beforeBuilder=null;const ref=option('--before-ref'),snapshot=option('--before-snapshot');
if(ref||snapshot){
  if(ref&&!/^[a-f0-9]{7,40}$/.test(ref))throw Error('before-ref must be a commit hash');
  let text=snapshot?await readFile(path.resolve(snapshot),'utf8'):execFileSync('git',['show',ref+':src/lib/news/standings-html.ts'],{cwd:root,encoding:'utf8'});
  text=text.replace('../../../render/assets/leagues/symbols/',pathToFileURL(path.join(root,'render/assets/leagues/symbols/')).href+'/');
  for(const [from,to] of [['./html.ts','src/lib/news/html.ts'],['./standings.ts','src/lib/news/standings.ts'],['../../../render/league-accents.js','render/league-accents.js']])text=text.replaceAll("'"+from+"'","'"+pathToFileURL(path.join(root,to)).href+"'");
  const file=path.join(out,'private-before-template.mjs');await writeFile(path.join(out,'private-before-template.source.txt'),text);await writeFile(file,stripTypeScriptTypes(text));beforeBuilder=(await import(pathToFileURL(file).href)).buildStandingsHtml;
}
const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const secret=randomUUID(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(process.execPath,[path.join(root,'render/render-server.js')],{cwd:root,env:{...process.env,RENDER_PORT:String(port),NEWS_RENDER_SECRET:secret,DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused'},stdio:['ignore','pipe','pipe']});
let log='';const collect=b=>log=(log+b).slice(-4000);child.stdout.on('data',collect);child.stderr.on('data',collect);
let browser;let manifest=only&&existsSync(path.join(out,'manifest.json'))?JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8')).scenarios.filter(s=>s.file!==only+'.jpg'):[];
try{
  for(let i=0;;i++){if(child.exitCode!==null)throw Error('Local preview renderer exited');try{if((await fetch(`http://127.0.0.1:${port}/news-health`,{headers:{'x-news-render-secret':secret},signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i>225)throw Error('Local preview renderer startup timeout');await wait(200);}
  if(beforeBuilder)browser=await chromium.launch({headless:true});
  const tables=new Map();
  if(only&&!scenarios.some(s=>s[0]===only))throw Error('Unknown review scenario');
  for(const [name,league,count,ratio] of scenarios){
    if(only&&name!==only)continue;
    if(!tables.has(league))tables.set(league,await table(league));const t=structuredClone(tables.get(league));
    let selection=Array.from({length:count},(_,i)=>i+1);
    if(name.includes('long-names')){const arsenal={...t.rows[0]};for(const [i,id] of [66,397,351].entries()){Object.assign(t.rows[i],{teamId:String(id),name:({66:'Manchester United FC',397:'Brighton & Hove Albion FC',351:'Nottingham Forest FC'})[id],crest:(await crest(String(id))).toString('base64')});}Object.assign(t.rows[5],{teamId:arsenal.teamId,name:arsenal.name,crest:arsenal.crest});}
    if(name.includes('tied')){Object.assign(t.rows[27],{teamId:'94',name:'Villarreal CF'});Object.assign(t.rows[30],{teamId:'675',name:'Feyenoord Rotterdam'});t.rows[28].teamId='1899';t.rows[28].name='AEK Athens';t.rows[29].teamId='721';t.rows[29].name='RB Leipzig';t.rows[29].position=29;t.rows[29].points=t.rows[28].points;t.rows[29].goalDifference=t.rows[28].goalDifference;selection=[28,29,30,31];for(const i of [27,28,29,30])t.rows[i].crest=(await crest(String(i===28?1899:i===29?721:i===30?675:94))).toString('base64');}
    const job=await createStandingsService({id:'private-fixture',getCurrentTable:async()=>t})(league,selection);
    job.composition=composition;
    const r=await fetch(`http://127.0.0.1:${port}/render-news`,{method:'POST',headers:{'content-type':'application/json','x-news-render-secret':secret},body:JSON.stringify({job,background:backgrounds[ratio].toString('base64'),circle:null}),signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw Error('Preview failed for '+name);const result=await r.json();
    const dest=path.join(out,name+'.jpg');await copyFile(result.jpg_path,dest);const meta=await sharp(await readFile(dest)).metadata();if(meta.width!==1080||meta.height!==1350)throw Error('Unexpected preview size');
    if(beforeBuilder&&count<=6&&!name.includes('tied')){
      const context=await browser.newContext({viewport:{width:2160,height:2700},deviceScaleFactor:1});
      try{const page=await context.newPage();await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():r.abort());
      const beforeJob=structuredClone(job),backings=[];
      for(const row of beforeJob.standings.rows){const mark=await normalizeStandingsCrest(Buffer.from(row.crest,'base64'));row.crest=mark.png.toString('base64');backings.push(mark.lightBacking);}
      const primary=await sharp(backgrounds[ratio]).rotate().png().toBuffer();
      // Reproduce the superseded baseline ONLY for labelled before comparisons.
      const previousBackdrop=await sharp(primary).resize(216,270,{fit:'cover'}).blur(7).png().toBuffer();
      await page.setContent(beforeBuilder(beforeJob,primary,previousBackdrop,backings));await page.waitForFunction(()=>document.documentElement.getAttribute('data-ready')==='1');const png=await page.screenshot({type:'png'});await sharp(png).resize(1080,1350,{kernel:'lanczos3'}).withIccProfile('srgb').jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(path.join(out,name+'-before.jpg'));}finally{await context.close();}
    }
    manifest.push({file:name+'.jpg',leagueId:league,rows:count,background:ratio,officialRanks:job.standings.rows.map(r=>r.position),bytes:meta.size,fictional:true,composition,names:job.standings.rows.map(r=>({teamId:r.teamId,provider:r.name,...clubDisplayName(r)}))});console.log('Rendered '+name);
  }
  manifest.sort((a,b)=>a.file.localeCompare(b.file));
  const tileW=270,tileH=338,label=44,cols=4;
  const layers=[];
  for(let i=0;i<manifest.length;i++){const x=(i%cols)*tileW,y=Math.floor(i/cols)*(tileH+label);layers.push({input:await sharp(await readFile(path.join(out,manifest[i].file))).resize(tileW,tileH).png().toBuffer(),left:x,top:y+label});const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="270" height="44"><text x="10" y="18" fill="white" font-family="sans-serif" font-size="12">${manifest[i].file.replace('.jpg','')}</text><text x="10" y="35" fill="#c3ccd5" font-family="sans-serif" font-size="11">FICTIONAL DATA / ${manifest[i].background}</text></svg>`);layers.push({input:svg,left:x,top:y});}
  await sharp({create:{width:cols*tileW,height:Math.ceil(manifest.length/cols)*(tileH+label),channels:3,background:'#101820'}}).composite(layers).jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(path.join(out,'contact-sheet.jpg'));
  for(const name of ['01-premier-original-3','02-premier-original-4','09-laliga-landscape-3','10-premier-long-names-3']){const names=[name+'-before.jpg',name+'.jpg'];if(!existsSync(path.join(out,names[0])))continue;const tiles=await Promise.all(names.map(async(f,i)=>({input:await sharp(await readFile(path.join(out,f))).resize(540,675).png().toBuffer(),left:i*540,top:48})));const labels=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="48"><text x="24" y="30" fill="white" font-family="sans-serif" font-size="22">BEFORE / FICTIONAL</text><text x="564" y="30" fill="white" font-family="sans-serif" font-size="22">AFTER / FICTIONAL</text></svg>');await sharp({create:{width:1080,height:723,channels:3,background:'#101820'}}).composite([{input:labels,left:0,top:0},...tiles]).jpeg({quality:97}).toFile(path.join(out,name+'-comparison.jpg'));}
  await writeFile(path.join(out,'manifest.json'),JSON.stringify({note:'Fictional standings only. Original input bytes unchanged. Final cover crop is deterministic. Square/landscape inputs are explicit 50% X / 22% Y crops of the same photo. No Telegram messages or football-data API requests.',scenarios:manifest},null,2));
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Private fictional standings review</title><style>body{background:#101820;color:white;font:16px Arial;margin:24px}a{color:#9bd9ff}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}img{width:100%;height:auto}figure{margin:0}figcaption{padding:12px 0}</style><h1>Local design review / fictional statistics</h1><p>Real club marks, fictional standings. Click images for full 1080 ? 1350 JPEG.</p><p><a href="contact-sheet.jpg">Contact sheet</a></p><main>${manifest.map(s=>`<figure><a href="${s.file}"><img src="${s.file}"></a><figcaption>${escape(s.file)} / ${s.background}<br>${s.names.map(n=>escape(n.name)).join(', ')}</figcaption></figure>`).join('')}</main>`);
  console.log('PRIVATE PREVIEWS: '+out);
}finally{await browser?.close();if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([exit,wait(5000)]);}}
