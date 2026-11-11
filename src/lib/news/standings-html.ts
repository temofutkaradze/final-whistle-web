import { readFileSync, existsSync } from 'node:fs';
import { bundledFonts } from './html.ts';
import { validateTable, standingsLeagues, type StandingsJob, type StandingsComposition } from './standings.ts';
import { clubDisplayName } from './club-display-names.ts';
import { leagueAccents } from '../../../render/league-accents.js';
const esc=(s:unknown)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const image=(bytes:Buffer)=>`data:image/${bytes[0]===137?'png':bytes[0]===255?'jpeg':'webp'};base64,${bytes.toString('base64')}`;
// Reuse reviewed Match symbols without altering them; provider artwork is the fallback.
const symbols=new Map<number,string>(standingsLeagues.flatMap(l=>{
  const file=new URL(`../../../render/assets/leagues/symbols/${l.id}.png`,import.meta.url);
  return existsSync(file)?[[l.id,image(readFileSync(file))] as const]:[];
}));
export function standingsGeometry(count:number){
  if(!Number.isSafeInteger(count)||count<1||count>64)throw Error('Invalid standings row count');
  // Deliberate editorial geometries for the two primary use cases.
  if(count===3)return {rowHeight:72,font:29,headerHeight:78,bottom:46,padding:10};
  if(count===4)return {rowHeight:68,font:28,headerHeight:78,bottom:46,padding:10};
  const rowHeight=count<3?74:count<=6?62:Math.min(60,Math.floor(900/count));
  return {rowHeight,font:count<=6?28:Math.max(14,Math.min(28,Math.floor(rowHeight*.45))),headerHeight:count<=6?78:68,bottom:46,padding:10};
}
export function standingsComposition(value:StandingsComposition={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid standings composition');
  const {backgroundX=50,backgroundY=22,panelOffset=0}=value;
  if(![backgroundX,backgroundY,panelOffset].every(n=>typeof n==='number'&&Number.isFinite(n))||backgroundX<0||backgroundX>100||backgroundY<0||backgroundY>100||panelOffset< -20||panelOffset>200)throw Error('Invalid standings composition');
  return {backgroundX,backgroundY,panelOffset};
}
export function buildStandingsHtml(job:StandingsJob,background:Buffer,crestBackings:readonly boolean[]=[]):string{
  const t=validateTable(job.standings,job.standings?.leagueId,Date.now(),true);
  const league=standingsLeagues.find(l=>l.id===t.leagueId)!;
  const accent=leagueAccents(t.leagueId);
  const {rowHeight,font,headerHeight,bottom,padding}=standingsGeometry(t.rows.length);
  const {backgroundX,backgroundY,panelOffset}=standingsComposition(job.composition);
  const kicker=t.source.includes('FICTIONAL')?'LEAGUE TABLE / FICTIONAL PREVIEW':'LEAGUE TABLE';
  const logo=symbols.get(t.leagueId)??image(Buffer.from(t.leagueLogo,'base64'));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  ${bundledFonts}
  *{box-sizing:border-box}html,body{margin:0;width:2160px;height:2700px;overflow:hidden}
  .post{position:relative;width:1080px;height:1350px;transform:scale(2);transform-origin:top left;font-family:Montserrat,Arial,sans-serif;color:#f8fafc;background:#17212a;overflow:hidden}
  .background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${backgroundX}% ${backgroundY}%}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,9,14,0) 48%,rgba(4,9,14,.10) 70%,rgba(4,9,14,.62) 100%)}
  .table{position:absolute;bottom:${bottom+panelOffset}px;left:54px;width:972px;border-radius:14px;padding-bottom:${padding}px;overflow:hidden;background:linear-gradient(135deg,rgba(9,17,26,.87),rgba(5,12,20,.78));box-shadow:0 16px 48px rgba(0,0,0,.18)}
  .accent{height:2px}
  .table:after{content:'';position:absolute;inset:0;border:2px solid transparent;border-radius:inherit;background:${accent.left} border-box;mask:linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0);mask-composite:exclude;opacity:.85;pointer-events:none}
  .row,header{display:grid;grid-template-columns:42px 54px minmax(0,1fr) 62px 76px 82px;column-gap:15px;align-items:center;padding:0 28px}
  .row{height:${rowHeight}px;font-size:${font}px;font-weight:800;position:relative}
  .row:not(:last-child):after{content:'';position:absolute;bottom:0;left:28px;right:28px;height:1px;background:rgba(255,255,255,.1)}
  .crest{width:${Math.min(44,rowHeight-8)}px;height:${Math.min(44,rowHeight-8)}px;object-fit:contain;justify-self:center}
  .crest.light-backing{background:#f0f3f6;border-radius:8px;padding:5px}
  .name{line-height:1.08;white-space:nowrap;min-width:0;font-size:${font}px;letter-spacing:-.5px}
  .number{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  .rank{font-size:${Math.max(15,font-3)}px;color:#bac5d0}
  .stat{font-size:${Math.max(14,font-4)}px;color:#d8e0e8}
  .points{font-size:${font+4}px;color:white;letter-spacing:-1px}
  header{height:${headerHeight}px;font-weight:800;position:relative}
  header:after{content:'';position:absolute;bottom:0;left:28px;right:28px;height:1px;background:rgba(255,255,255,.22)}
  .identity{grid-column:1 / 4;display:flex;align-items:center;gap:18px;min-width:0}
  .league-mark{width:48px;height:48px;object-fit:contain;filter:brightness(0) invert(1);flex:none}
  .kicker{font-size:11px;letter-spacing:2.3px;color:#aebcca;margin-bottom:6px;white-space:nowrap}
  .league-name{font-family:'League Gothic',Arial,sans-serif;font-size:35px;font-weight:400;letter-spacing:.9px;line-height:1;white-space:nowrap}
  header .number{font-size:16px;letter-spacing:1px;color:#b4c2d0}
  </style></head><body><main class="post"><img class="background" src="${image(background)}"><div class="shade"></div><section class="table"><div class="accent"></div><header><div class="identity"><img class="league-mark" src="${logo}"><div><div class="kicker">${kicker}</div><div class="league-name">${esc(league.name.toUpperCase())}</div></div></div><span class="number">P</span><span class="number">GD</span><span class="number">PTS</span></header>${t.rows.map((r,i)=>{const display=clubDisplayName(r);return `<div class="row"><span class="number rank">${r.position}</span><img class="crest${crestBackings[i]?' light-backing':''}" src="${image(Buffer.from(r.crest,'base64'))}"><span class="name" data-team-id="${esc(r.teamId)}" data-name-review="${display.needsReview}">${esc(display.name)}</span><span class="number stat">${r.played}</span><span class="number stat">${r.goalDifference>0?'+':''}${r.goalDifference}</span><strong class="number points">${r.points}</strong></div>`;}).join('')}</section></main><script>Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())]).then(()=>{for(const e of document.querySelectorAll('.name')){let size=parseFloat(getComputedStyle(e).fontSize);while(e.scrollWidth>e.clientWidth&&size>10){e.style.fontSize=(--size)+'px';}if(e.scrollWidth>e.clientWidth||e.scrollHeight>e.parentElement.clientHeight-4)throw Error('Team name cannot fit');}for(const row of document.querySelectorAll('.row')){for(const e of row.querySelectorAll('.number')){let size=parseFloat(getComputedStyle(e).fontSize);while(e.scrollWidth>e.clientWidth&&size>10)e.style.fontSize=(--size)+'px';if(e.scrollWidth>e.clientWidth)throw Error('Statistic cannot fit');}}document.documentElement.setAttribute('data-ready','1');}).catch(()=>{document.documentElement.setAttribute('data-error','Standings layout or image decode failed');document.documentElement.setAttribute('data-ready','1')});</script></body></html>`;
}
