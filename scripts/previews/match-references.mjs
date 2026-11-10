// Local, isolated visual verification; no .env, database, bot or delivery client.
// node scripts/previews/match-references.mjs [--background <approved-photo>] [--logos]
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import {buildEventsHtml} from '../lib/events.mjs';
import {fitClassicTeamNames} from '../../render/match-layout.js';
import {referenceScenarios} from '../../tests/fixtures/match-reference-scenarios.mjs';
import {sampleMatchFields} from '../../src/lib/sample-match.ts';
import {buildJob} from '../../src/lib/news/parse.ts';
const inspectAt=process.argv.indexOf('--inspect-existing');
const inspect=inspectAt>=0;
const root=process.cwd(),output=path.resolve(inspect?process.argv[inspectAt+1]:'storage/match-reference-previews/run-'+Date.now());
fs.mkdirSync(output,{recursive:true});
const backgroundArg=process.argv.indexOf('--background');
const photo=backgroundArg<0?null:fs.readFileSync(process.argv[backgroundArg+1]);
const background=photo?'data:image/'+(await sharp(photo).metadata()).format+';base64,'+photo.toString('base64'):sampleMatchFields().background_data_uri;
const realLogos=process.argv.includes('--logos'),secret=crypto.randomUUID();
const rows=[],comparisons={};
const port=()=>new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function start(baseline){
 const p=await port();
 const loader=baseline?`const fs=require('fs'),path=require('path'),Module=require('module'),{execFileSync}=require('child_process');const file=path.resolve('render/render-server.js'),original=fs.readFileSync;const classic=execFileSync('git',['show','origin/main:render/templates/classic.html']);fs.readFileSync=function(p,...args){if(path.resolve(String(p))===path.resolve('render/templates/classic.html'))return args[0]?classic.toString('utf8'):classic;return original.call(this,p,...args);};const source=execFileSync('git',['show','origin/main:render/render-server.js'],{encoding:'utf8'});const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);`:null;
 const child=spawn(process.execPath,loader?['-e',loader]:['render/render-server.js'],{cwd:root,env:{...process.env,NEWS_RENDER_SECRET:secret,RENDER_PORT:String(p)},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 const start=Date.now();while(!/Warm-up (done|skipped)/.test(log)){if(child.exitCode!==null||Date.now()-start>90000){child.kill();throw Error('Isolated renderer failed: '+log.slice(-2000));}await new Promise(r=>setTimeout(r,100));}
 return {child,async render(payload,news=false){const response=await fetch(`http://127.0.0.1:${p}/${news?'render-news':'render'}`,{method:'POST',headers:{'content-type':'application/json','x-news-render-secret':secret},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});const result=await response.json();if(!response.ok)throw Error('Preview render failed: '+JSON.stringify(result));return result;},async stop(){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}};
}
const sample=sampleMatchFields();
function payload(s){return {...sample,...s.match,...buildEventsHtml(s.events,s.match),fixture_id:'reference_'+s.id,league_id:s.league,page_name:'DAY\nON\nFOOTBALL',background_data_uri:background};}
// Baseline comparison uses identical synthetic assets and the actual HTTP/export
// pipeline on each revision. Never replaces production code or installs hooks.
if(!inspect)for(const baseline of[true,false]){
 const server=await start(baseline);
 try{
  for(const template of['classic','panel','frame','stripe']){
   const r=await server.render({...sample,fixture_id:'reference_compare_'+template,template,league_id:999,page_name:'DAY\nON\nFOOTBALL'});
   const bytes=fs.readFileSync(r.jpg_path);const name=(baseline?'before-':'after-')+template+'.jpg';fs.writeFileSync(path.join(output,name),bytes);
   const sha=crypto.createHash('sha256').update(bytes).digest('hex');(comparisons[template]??={})[baseline?'before':'after']=sha;
  }
  for(const layout of['single','left','right','breaking']){
   const job=buildJob('SYNTHETIC FOOTBALL HEADLINE',layout==='left'||layout==='right',layout);
   const png=await sharp({create:{width:1080,height:1350,channels:3,background:'#244d31'}}).png().toBuffer();
   const r=await server.render({job,background:png.toString('base64'),circle:layout==='left'||layout==='right'?png.toString('base64'):null},true);
   const bytes=fs.readFileSync(r.jpg_path);fs.writeFileSync(path.join(output,(baseline?'before-':'after-')+'news-'+layout+'.jpg'),bytes);const sha=crypto.createHash('sha256').update(bytes).digest('hex');(comparisons['news-'+layout]??={})[baseline?'before':'after']=sha;
  }
  if(!baseline){
   for(const s of referenceScenarios){const r=await server.render(payload(s));const dest=path.join(output,s.id+'.jpg');fs.copyFileSync(r.jpg_path,dest);rows.push({id:s.id,path:dest,html:r.html_path});fs.writeFileSync(path.join(output,'render-manifest.json'),JSON.stringify(rows));}
   for(const [id,home,away,hs,as,hid,aid]of[[2,'Real Madrid','Manchester City',1,2,541,50],[61,'Paris Saint Germain','Marseille',2,0,85,81],[78,'Bayern Munich','Dortmund',4,0,157,165],[135,'Juventus','Inter',1,1,496,505],[39,'Manchester United','Liverpool',2,1,33,40],[140,'Real Madrid','Barcelona',3,2,541,529]]){
    const s={id:'league_'+id,league:id,match:{home_team:home,away_team:away,home_score:hs,away_score:as},events:[]};
    const r=await server.render({...payload(s),...(realLogos?{home_logo:`https://media.api-sports.io/football/teams/${hid}.png`,away_logo:`https://media.api-sports.io/football/teams/${aid}.png`,league_logo:`https://media.api-sports.io/football/leagues/${id}.png`}:{})});fs.copyFileSync(r.jpg_path,path.join(output,'league-'+id+'.jpg'));
   }
  }
 }finally{await server.stop();}
}
if(inspect){rows.push(...JSON.parse(fs.readFileSync(path.join(output,'render-manifest.json'),'utf8')));for(const name of['classic','panel','frame','stripe','news-single','news-left','news-right','news-breaking'])for(const phase of['before','after']){const bytes=fs.readFileSync(path.join(output,phase+'-'+name+'.jpg'));(comparisons[name]??={})[phase]=crypto.createHash('sha256').update(bytes).digest('hex');}}
for(const [name,c]of Object.entries(comparisons)){
 c.byteIdentical=c.before===c.after;
 if(!c.byteIdentical){const before=await sharp(path.join(output,'before-'+name+'.jpg')).removeAlpha().raw().toBuffer(),after=await sharp(path.join(output,'after-'+name+'.jpg')).removeAlpha().raw().toBuffer();let sum=0,max=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);sum+=d;max=Math.max(max,d);}c.meanChannelDifference=sum/before.length;c.maxChannelDifference=max;}
}

const tiles=[];
for(let i=0;i<rows.length;i++){
 const r=rows[i],s=referenceScenarios[i];
 const tile=await sharp(r.path).extract({left:0,top:850,width:1080,height:500}).resize(360,167).extend({top:27,bottom:0,left:0,right:0,background:'#111'}).composite([{input:Buffer.from(`<svg width="360" height="27"><text x="6" y="18" font-family="sans-serif" font-size="11" fill="#ffd400">#${s.id} ${s.home} ${s.hs}-${s.as} ${s.away}</text></svg>`),top:0,left:0}]).jpeg({quality:97,chromaSubsampling:'4:4:4'}).toBuffer();tiles.push({input:tile,left:(i%3)*360,top:Math.floor(i/3)*194});
}
await sharp({create:{width:1080,height:6*194,channels:3,background:'#000'}}).composite(tiles).withIccProfile('srgb').jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(path.join(output,'scenarios.jpg'));
// Inspect actual rendered HTML with real Chromium: loaded Montserrat and bounds.
const browser=await chromium.launch();
const geometry=[];
try{const page=await browser.newPage({viewport:{width:1080,height:1350}});for(const r of rows){await page.goto(pathToFileURL(r.html).href);await page.evaluate(()=>document.fonts.ready);await fitClassicTeamNames(page);geometry.push({id:r.id,...await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return{fontLoaded:[...document.fonts].some(f=>f.family==='Montserrat'&&f.status==='loaded'),lines:[...document.querySelectorAll('.league-line')].map(rect),score:rect(document.querySelector('.score-text')),events:[...document.querySelectorAll('.event')].map(rect),names:[...document.querySelectorAll('.team-name')].map(e=>({...rect(e),scrollWidth:e.scrollWidth}))};})});}}finally{await browser.close();}
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({comparisons,geometry,photoProvided:!!photo,realLogos,output},null,2));
console.log(JSON.stringify({output,scenarios:rows.length,byteComparisons:comparisons,fontsLoaded:geometry.every(r=>r.fontLoaded),overflow:geometry.filter(r=>r.events.some(e=>e.bottom>1350||e.x<0||e.right>1080)||r.names.some(e=>e.scrollWidth>e.width))},null,2));

if(Object.values(comparisons).some(c=>!c.byteIdentical))process.exitCode=1; // Keep evidence; never claim byte identity on failure.
