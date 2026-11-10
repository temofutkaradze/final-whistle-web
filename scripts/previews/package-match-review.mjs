// Package only known QA outputs; never scan renderer/user output directories.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {referenceScenarios} from '../../tests/fixtures/match-reference-scenarios.mjs';

const descriptions = [
 'Normal goals and a grouped hat-trick', 'Scored penalty, missed penalty and added-time goal',
 'Own goal credited to its beneficiary', 'Normal goals combined with an own goal',
 'Own goals involving both teams', 'Goal, straight red and second-yellow dismissal',
 '0-0 draw with dismissals', 'Normal goals and multiword names',
 'Distinct players with the same abbreviated name', 'Extra time, added time and scored penalty',
 'Missing scorer name: minute only', 'Four scorers plus a red card',
 '0-0 draw: ordinary yellow/substitution/cancelled goal filtered out',
 'Added-time scored penalty', 'High-scoring 5-4: long name and crowded scorer list',
 'Goals, own goal, scored/missed penalties and dismissal', 'Official score available; event feed unavailable',
];
const leagues = [[2,'Champions League','Real Madrid','Manchester City',1,2],
 [61,'Ligue 1','Paris Saint Germain','Marseille',2,0],
 [78,'Bundesliga','Bayern Munich','Dortmund',4,0],
 [135,'Serie A','Juventus','Inter',1,1],
 [39,'Premier League','Manchester United','Liverpool',2,1],
 [140,'La Liga','Real Madrid','Barcelona',3,2],
 [5,'Nations League','Georgia','France',1,2],
 [999,'Unknown league: white fallback','Northbridge FC','Southport Athletic',0,0]];
export const reviewCases = [
 ...referenceScenarios.map((s,i)=>({file:`${s.id}.jpg`,id:String(s.id),description:descriptions[i],
   home:s.home,away:s.away,homeScore:s.hs,awayScore:s.as,leagueId:s.league,events:s.events})),
 ...leagues.map(([id,name,home,away,hs,as])=>({file:`league-${id}.jpg`,id:`league-${id}`,
   description:`Same Classic template: ${name} accent`,home,away,homeScore:hs,awayScore:as,leagueId:id,events:[],
   eventFeed:'Intentionally omitted for a color-only comparison'})),
];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const wrap=(s,max=34)=>{const lines=[''];for(const word of String(s).split(/\s+/)){const i=lines.length-1;if(lines[i]&&lines[i].length+word.length+1>max)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}return lines;};

export async function packageReview(source, destination) {
 source=path.resolve(source);destination=path.resolve(destination);
 const inputs=[];
 for(const item of reviewCases){
  const bytes=await fs.readFile(path.join(source,item.file)),meta=await sharp(bytes).metadata();
  if(meta.width!==1080||meta.height!==1350||meta.format!=='jpeg'||meta.exif)throw Error(`Invalid or non-private QA image: ${item.file}`);
  inputs.push({...item,bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 // Exclusive folder: never overwrite an existing review or user image.
 await fs.mkdir(destination);
 await fs.mkdir(path.join(destination,'full-resolution'));
 const tiles=[],header=80,width=260,height=325,cellHeight=header+height;
 for(let i=0;i<inputs.length;i++){
  const item=inputs[i];await fs.writeFile(path.join(destination,'full-resolution',item.file),item.bytes,{flag:'wx'});
  const label=[`${item.id}: ${item.description}`,...wrap(`${item.home} ${item.homeScore}-${item.awayScore} ${item.away}`)];
  const lines=wrap(label[0]).concat(label.slice(1));
  const svg=Buffer.from(`<svg width="${width}" height="${header}"><rect width="100%" height="100%" fill="#171717"/>${lines.slice(0,5).map((line,n)=>`<text x="7" y="${15+n*14}" font-family="sans-serif" font-size="11" fill="${n<2?'#ffd400':'white'}">${esc(line)}</text>`).join('')}</svg>`);
  const tile=await sharp(item.bytes).resize(width,height).extend({top:header,bottom:0,left:0,right:0,background:'#171717'}).composite([{input:svg,top:0,left:0}]).png().toBuffer();
  tiles.push({input:tile,left:(i%5)*width,top:50+Math.floor(i/5)*cellHeight});
 }
 const banner=Buffer.from('<svg width="1300" height="50"><rect width="100%" height="100%" fill="#111"/><text x="14" y="31" font-family="sans-serif" font-size="20" fill="white">FICTIONAL QA PREVIEWS - NOT REAL RESULTS - APPROVAL PENDING</text></svg>');
 await sharp({create:{width:1300,height:50+Math.ceil(inputs.length/5)*cellHeight,channels:3,background:'#111'}})
  .composite([{input:banner,top:0,left:0},...tiles]).withIccProfile('srgb').jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(path.join(destination,'CONTACT-SHEET.jpg'));
 const manifest={approval:'PENDING_USER_REVIEW',fictional:true,dimensions:{width:1080,height:1350},
  provenance:'Actual Final Whistle HTTP renderer, persistent Chromium, Sharp JPEG export; no AI generation.',
  cases:inputs.map(({bytes,...item})=>({...item,file:'full-resolution/'+item.file}))};
 await fs.writeFile(path.join(destination,'MOCK-SCENARIOS.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 const quote=s=>'"'+String(s).replaceAll('"','""')+'"';
 await fs.writeFile(path.join(destination,'SCENARIOS.csv'),['File,Scenario,Home,Away,Home score,Away score,League ID',...inputs.map(i=>[i.file,i.description,i.home,i.away,i.homeScore,i.awayScore,i.leagueId].map(quote).join(','))].join('\n')+'\n',{flag:'wx'});
 await fs.writeFile(path.join(destination,'README.md'),`# Final Whistle visual review — approval pending\n\nAll ${inputs.length} results are fictional QA fixtures. Do not publish them as real football news.\n\nOpen CONTACT-SHEET.jpg for all previews; labels are outside the complete images. Every individual in full-resolution/ is an unmodified 1080x1350 JPG from the actual renderer. MOCK-SCENARIOS.json includes raw mock events, descriptions and SHA-256 hashes; SCENARIOS.csv is a short index.\n\nThe background is the existing CC0 QA sports photograph (https://pxhere.com/en/photo/1102099), not the missing original reference photograph. It does not depict the listed teams/results. A/B/L badges in the 17 scenario images are deliberate QA placeholders; the six club league examples use existing safe-downloaded logos. Nations League and unknown examples retain test badges. No logos in production were replaced.\n\nCompared with the supplied references: Classic geometry, typography, gradient, mirrored event rows and dimensions are retained; the league lines use sampled reference gradients and white fallback. The long-name case fits its box. A complete photo/pixel comparison still requires the clean original background/brand asset. Ordinary-goal icons and one nonchronological reference ordering remain pending decisions; current rules were preserved.\n\nThis bundle is for your review, not approval or deployment. Nothing is merged, deployed, sent to Telegram or written to production data by its generation.\n`,{flag:'wx'});
 const zip=destination+'.zip';
 const python='import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); archive=zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED); [(archive.write(p,p.relative_to(root).as_posix())) for p in sorted(root.rglob("*")) if p.is_file()]; archive.close()';
 const result=spawnSync('python',['-B','-c',python,destination,zip],{encoding:'utf8',timeout:60000});
 if(result.error||result.status!==0)throw Error('Preview ZIP creation failed; do not trust an incomplete bundle');
 return {destination,zip,images:inputs.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--source'||args[2]!=='--output')throw Error('Use --source <rendered-preview-folder> --output <new-bundle-folder>');
 console.log(JSON.stringify(await packageReview(args[1],args[3])));
}
