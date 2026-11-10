// Provider-neutral standings domain. No network, credentials or historical fallback.
import { LEAGUES } from '../leagues.ts';
export class StandingsError extends Error {
  code:string;
  constructor(code: string, message: string) { super(message); this.name='StandingsError'; this.code=code; }
}
export const DISABLED_MESSAGE='Current standings generation is not enabled: a free current-season source and its data/logo usage must be approved. Existing News posts still work.';
const aliases: Record<string,number>={'premier league':39,'epl':39,'la liga':140,'laliga':140,'serie a':135,'bundesliga':78,'ligue 1':61};
export const standingsLeagues=LEAGUES.filter(l=>[39,140,135,78,61].includes(l.id));
export function identifyLeague(value:string): number | undefined { return aliases[value.trim().toLowerCase().replace(/\s+/g,' ')]; }
export function parsePositions(value:string):number[]{
  if(value.length>200||!/^\d+(?:[\s,]+\d+)*$/.test(value.trim()))throw new StandingsError('STANDINGS_POSITIONS','Send positive positions separated by spaces, for example: 1 5 10 20.');
  const positions=[...new Set(value.trim().split(/[\s,]+/).map(Number))];
  if(positions.some(n=>!Number.isSafeInteger(n)||n<1||n>64))throw new StandingsError('STANDINGS_POSITIONS','Positions must be positive whole numbers within the selected league.');
  return positions;
}
export type StandingRow={position:number;teamId:string;name:string;played:number;goalDifference:number;points:number;crest:string};
// Logos are approved raster bytes encoded as base64, never URLs or SVG markup.
export type StandingsTable={leagueId:number;seasonStart:string;seasonEnd:string;source:string;fetchedAt:number;leagueLogo:string;totalTeams:number;rows:StandingRow[]};
export type StandingsJob={layout:'standings';author:string;quote:string;caption:string;pos:{b:[number,number,number];c:[number,number,number]};standings:StandingsTable};
export function validateTable(table:StandingsTable,leagueId:number,now=Date.now(),selected=false):StandingsTable{
  const fail=()=>{throw new StandingsError('STANDINGS_DATA','Current standings are incomplete, ambiguous or unavailable. Please try later.');};
  if(!table||!standingsLeagues.some(l=>l.id===leagueId)||table.leagueId!==leagueId||typeof table.source!=='string'||!table.source.trim()||table.source.length>160||!Number.isFinite(table.fetchedAt)||table.fetchedAt>now+60_000||now-table.fetchedAt>60*60_000)fail();
  const start=Date.parse(table.seasonStart),end=Date.parse(table.seasonEnd);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<now||end<=start||end-start>400*86400_000)fail();
  if(!Array.isArray(table.rows)||table.rows.length<2||table.rows.length>64||!Number.isSafeInteger(table.totalTeams)||table.totalTeams<2||table.totalTeams>24||table.rows.length>table.totalTeams||(!selected&&table.rows.length!==table.totalTeams)||!rasterBase64(table.leagueLogo))fail();
  const ranks=new Set(),teams=new Set();
  for(const r of table.rows){
    if(!r||!Number.isSafeInteger(r.position)||r.position<1||r.position>table.totalTeams||ranks.has(r.position)||typeof r.teamId!=='string'||!r.teamId||teams.has(r.teamId)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100||!Number.isSafeInteger(r.played)||r.played<0||r.played>100||!Number.isSafeInteger(r.goalDifference)||Math.abs(r.goalDifference)>1000||!Number.isSafeInteger(r.points)||Math.abs(r.points)>500||!rasterBase64(r.crest))fail();
    ranks.add(r.position);teams.add(r.teamId);
  }
  return table;
}
export function rasterBase64(value:unknown):value is string{
  if(typeof value!=='string'||value.length>700_000||value.length%4!==0||!value.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
  const b=Buffer.from(value,'base64');
  return (b[0]===137&&b.subarray(1,4).toString()==='PNG')||(b[0]===255&&b[1]===216)||(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP');
}
export function selectPositions(table:StandingsTable,positions:number[]):StandingRow[]{
  if(!positions.length||new Set(positions).size!==positions.length)throw new StandingsError('STANDINGS_POSITIONS','Choose at least one unique position.');
  return positions.map(p=>{const row=table.rows.find(r=>r.position===p);if(!row)throw new StandingsError('STANDINGS_POSITIONS',`Position ${p} is unavailable; this league has ${table.rows.length} teams.`);return row;});
}
export type StandingsProvider={id:string;getCurrentTable:(leagueId:number)=>Promise<StandingsTable>};
// Fixed five-league key space, one in-flight request per league, no stale fallback.
export function createStandingsService(provider:StandingsProvider|null,now=Date.now){
  const cache=new Map<number,{expires:number;table:StandingsTable}>();
  const inflight=new Map<number,Promise<StandingsTable>>();
  return async(leagueId:number,positions:number[]):Promise<StandingsJob>=>{
    if(!provider)throw new StandingsError('STANDINGS_DISABLED',DISABLED_MESSAGE);
    if(!standingsLeagues.some(l=>l.id===leagueId))throw new StandingsError('STANDINGS_LEAGUE','Choose Premier League, La Liga, Serie A, Bundesliga or Ligue 1.');
    let table=cache.get(leagueId)?.table;
    if(!table||cache.get(leagueId)!.expires<=now()){
      let work=inflight.get(leagueId);
      if(!work){work=Promise.resolve().then(()=>provider.getCurrentTable(leagueId)).then(t=>{validateTable(t,leagueId,now());const copy=structuredClone(t);cache.set(leagueId,{table:copy,expires:Math.min(now()+15*60_000,Date.parse(t.seasonEnd))});return copy;}).catch(()=>{throw new StandingsError('STANDINGS_UNAVAILABLE','The current standings source is unavailable. No historical or example data was substituted.');}).finally(()=>inflight.delete(leagueId));inflight.set(leagueId,work);}
      table=await work;
    }
    validateTable(table,leagueId,now());
    const selected=structuredClone({...table,rows:selectPositions(table,positions)});
    return {layout:'standings',author:'',quote:'',caption:`${standingsLeagues.find(l=>l.id===leagueId)!.name} standings - ${table.seasonStart.slice(0,4)}-${table.seasonEnd.slice(0,4)}\n${table.source}`,pos:{b:[50,50,1],c:[50,30,1]},standings:selected};
  };
}
export type StandingsPending={kind:'standings';background?:string;leagueId?:number;positions?:number[];ts:number};
export function standingsTransition(msg:{text?:string;caption?:string;photo?:{file_id:string}[];document?:{file_id:string;mime_type?:string}},raw:unknown,now:number):null|{pending:StandingsPending|null;reply:string}|{pending:null;background:string;request:{leagueId:number;positions:number[]}}{
  let p=raw&&typeof raw==='object'&&(raw as StandingsPending).kind==='standings'?raw as StandingsPending:null;
  if(p&&now-p.ts>60*60_000)p=null;
  const file=msg.document?.mime_type?.match(/^image\/(jpeg|png|webp)$/)?msg.document.file_id:msg.photo?.at(-1)?.file_id;
  let text=(msg.text??msg.caption??'').trim();
  const command=/^\/standings(?:@\w+)?(?:\s|$)/i.test(text);
  const direct=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(alias=>text.toLowerCase()===alias||text.toLowerCase().startsWith(alias+' ')||text.toLowerCase().startsWith(alias+'\n'));
  if(!p&&!command&&!direct&&!(file&&/\d+(?:[\s,]+\d+)*$/.test(text)))return null;
  if(/^\/cancel(?:@\w+)?$/i.test(text))return {pending:null,reply:'Standings cancelled. Send a new background for a News post.'};
  if(/^\/(help|start)(?:@\w+)?$/i.test(text))return {pending:p,reply:'Standings: send a photo, league and positions, or /cancel to return to News.'};
  if(/^\//.test(text)&&!command)return {pending:p,reply:'Finish standings or use /cancel before another News command.'};
  if(command)text=text.replace(/^\/standings(?:@\w+)?\s*/i,'');
  const legacy=raw&&typeof raw==='object'&&(raw as {kind?:string}).kind!=='standings'&&Number.isFinite((raw as {ts?:number}).ts)&&now-((raw as {ts:number}).ts)<=60*60_000&&(raw as {background?:unknown}).background;
  p={...(p??{kind:'standings',ts:now,...(typeof legacy==='string'?{background:legacy}:{})}),ts:now};
  if(file)p.background=file;
  if(text){
    const match=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(alias=>text.toLowerCase()===alias||text.toLowerCase().startsWith(alias+' ')||text.toLowerCase().startsWith(alias+'\n'));
    if(match){p.leagueId=aliases[match];text=text.slice(match.length).trim();}
    else if(!p.leagueId)return {pending:p,reply:'Choose Premier League, La Liga, Serie A, Bundesliga or Ligue 1.'};
    if(text){try{p.positions=parsePositions(text);}catch(e){delete p.positions;return {pending:p,reply:(e as Error).message};}}
  }
  if(!p.background)return {pending:p,reply:'Send the background photo or an image file.'};
  if(!p.leagueId)return {pending:p,reply:'Send the league name.'};
  if(!p.positions)return {pending:p,reply:'Send positions, for example: 1 2 3.'};
  return {pending:null,background:p.background,request:{leagueId:p.leagueId,positions:p.positions}};
}
