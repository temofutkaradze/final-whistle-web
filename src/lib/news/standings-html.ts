import { bundledFonts } from './html.ts';
import { validateTable, standingsLeagues, type StandingsJob } from './standings.ts';
import { leagueAccents } from '../../../render/league-accents.js';
const esc=(s:unknown)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const image=(base64:string)=>{const b=Buffer.from(base64,'base64');return `data:image/${b[0]===137?'png':b[0]===255?'jpeg':'webp'};base64,${base64}`;};
export function buildStandingsHtml(job:StandingsJob,background:Buffer):string{
  const t=validateTable(job.standings,job.standings?.leagueId,Date.now(),true);
  const league=standingsLeagues.find(l=>l.id===t.leagueId)!;
  const accent=leagueAccents(t.leagueId);
  const rowHeight=Math.min(100,Math.floor(1020/t.rows.length));
  const font=Math.min(34,Math.max(20,Math.floor(rowHeight*.38)));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  ${bundledFonts}
  *{box-sizing:border-box}html,body{margin:0;width:2160px;height:2700px;background:#080b0e;overflow:hidden}
  .post{position:relative;width:1080px;height:1350px;transform:scale(2);transform-origin:top left;font-family:Montserrat,Arial,sans-serif;color:white}
  .background{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
  .shade{position:absolute;inset:0;background:linear-gradient(transparent 35%,rgba(0,0,0,.16) 65%,rgba(0,0,0,.75))}
  .table{position:absolute;bottom:62px;left:54px;width:972px;background:rgba(3,6,10,.78);padding:2px;border-radius:3px;overflow:hidden}
  .frame{position:absolute;inset:0;padding:2px;background:${accent.left};mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;pointer-events:none}
  .line{height:1px;background:${accent.right};opacity:.75}
  .row{display:grid;grid-template-columns:58px 68px minmax(0,1fr) 75px 88px 92px;gap:12px;align-items:center;padding:0 20px;height:${rowHeight}px;font-size:${font}px;font-weight:800}
  .row img{width:55px;height:${Math.min(62,rowHeight-10)}px;object-fit:contain;justify-self:center}
  .name{line-height:1.1;overflow-wrap:anywhere;font-size:${font}px}
  .number{text-align:center;font-variant-numeric:tabular-nums}.points{font-size:${font+4}px}
  header{height:74px;display:grid;grid-template-columns:68px minmax(0,1fr) 75px 88px 92px;gap:12px;align-items:center;padding:0 20px;font-size:25px;font-weight:800}
  header img{width:45px;height:48px;object-fit:contain;justify-self:center}header strong{font-style:italic;font-size:29px}
  footer{position:absolute;bottom:20px;left:54px;width:972px;font-size:14px;color:#ddd;line-height:1.2}
  </style></head><body><main class="post"><img class="background" src="data:image/png;base64,${background.toString('base64')}"><div class="shade"></div><section class="table"><div class="frame"></div><header><img src="${image(t.leagueLogo)}"><strong>${esc(league.name.toUpperCase())}</strong><span class="number">P</span><span class="number">GD</span><span class="number">PTS</span></header><div class="line"></div>${t.rows.map(r=>`<div class="row"><span class="number">${r.position}</span><img src="${image(r.crest)}"><span class="name">${esc(r.name)}</span><span class="number">${r.played}</span><span class="number">${r.goalDifference>0?'+':''}${r.goalDifference}</span><strong class="number points">${r.points}</strong></div><div class="line"></div>`).join('')}</section><footer>${esc(t.source)} &middot; Season ${esc(t.seasonStart.slice(0,4))}&ndash;${esc(t.seasonEnd.slice(0,4))} &middot; Retrieved ${esc(new Date(t.fetchedAt).toISOString().slice(0,16).replace('T',' '))} UTC</footer></main><script>Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())]).then(()=>{for(const e of document.querySelectorAll('.name')){let size=parseFloat(getComputedStyle(e).fontSize);while((e.scrollWidth>e.clientWidth||e.scrollHeight>e.parentElement.clientHeight-6)&&size>14){e.style.fontSize=(--size)+'px';}if(e.scrollWidth>e.clientWidth||e.scrollHeight>e.parentElement.clientHeight-6)throw Error('Team name cannot fit');}document.documentElement.setAttribute('data-ready','1');}).catch(()=>{document.documentElement.setAttribute('data-error','Image decode failed');document.documentElement.setAttribute('data-ready','1')});</script></body></html>`;
}
