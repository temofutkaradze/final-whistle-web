// Provider-neutral standings domain. No network, credentials or historical fallback.
import { LEAGUES } from '../leagues.ts';
import { uclOrderProblem } from './ucl-order.ts';
export class StandingsError extends Error {
  code:string;
  constructor(code: string, message: string) { super(message); this.name='StandingsError'; this.code=code; }
}
export const UCL_ROW_HELP='UCL numbers select display rows 1-36, not unique official ranks. Example: UCL 28 29 30 31 selects those four rows; tied official ranks may display 28, 29, 29, 31. Rank labels are never renumbered.';
export const DISABLED_MESSAGE='Current standings generation is not configured. Ask the account owner to set the server-side FOOTBALL_DATA_API_KEY. Existing News posts still work.';
const aliases: Record<string,number>={'premier league':39,'epl':39,'la liga':140,'laliga':140,'serie a':135,'bundesliga':78,'ligue 1':61,'champions league':2,'uefa champions league':2,'ucl':2,'cl':2};
export const standingsLeagues=LEAGUES.filter(l=>[39,140,135,78,61,2].includes(l.id));
export function validTeamCount(leagueId:number,count:number):boolean { return Number.isSafeInteger(count)&&(leagueId===2?count===36:count>=2&&count<=24); }
export function identifyLeague(value:string): number | undefined { return aliases[value.trim().toLowerCase().replace(/\s+/g,' ')]; }
export function parsePositions(value:string):number[]{
  if(value.length>200||!/^\d+(?:[\s,]+\d+)*$/.test(value.trim()))throw new StandingsError('STANDINGS_POSITIONS','Send positive positions separated by spaces, for example: 1 5 10 20.');
  const positions=[...new Set(value.trim().split(/[\s,]+/).map(Number))];
  if(positions.some(n=>!Number.isSafeInteger(n)||n<1||n>64))throw new StandingsError('STANDINGS_POSITIONS','Positions must be positive whole numbers within the selected league.');
  return positions;
}
// Date-only provider values include the whole UTC calendar day; timestamps stay exact.
export function seasonEndExclusive(value:unknown):number{
  if(typeof value!=='string')return NaN;
  const time=Date.parse(value);
  if(!Number.isFinite(time))return NaN;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(time).toISOString().slice(0,10)===value?time+86400_000:NaN;
  return time;
}
export type StandingRow={position:number;displayRow?:number;teamId:string;name:string;played:number;goalDifference:number;points:number;crest:string};
// Logos are approved raster bytes encoded as base64, never URLs or SVG markup.
export type StandingsTable={leagueId:number;seasonStart:string;seasonEnd:string;source:string;fetchedAt:number;leagueLogo:string;totalTeams:number;rows:StandingRow[]};
export type StandingsJob={layout:'standings';author:string;quote:string;caption:string;pos:{b:[number,number,number];c:[number,number,number]};standings:StandingsTable};
export function validateTable(table:StandingsTable,leagueId:number,now=Date.now(),selected=false):StandingsTable{
  const fail=()=>{throw new StandingsError('STANDINGS_DATA','Current standings are incomplete, ambiguous or unavailable. Please try later.');};
  if(!table||!standingsLeagues.some(l=>l.id===leagueId)||table.leagueId!==leagueId||typeof table.source!=='string'||!table.source.trim()||table.source.length>160||!Number.isFinite(table.fetchedAt)||table.fetchedAt>now+60_000||now-table.fetchedAt>60*60_000)fail();
  const start=Date.parse(table.seasonStart),end=Date.parse(table.seasonEnd),endExclusive=seasonEndExclusive(table.seasonEnd);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||!Number.isFinite(endExclusive)||now>=endExclusive||end<=start||end-start>400*86400_000)fail();
  if(!Array.isArray(table.rows)||table.rows.length<(selected?1:2)||table.rows.length>64||!validTeamCount(leagueId,table.totalTeams)||table.rows.length>table.totalTeams||(!selected&&table.rows.length!==table.totalTeams)||!rasterBase64(table.leagueLogo))fail();
  const ranks=new Set(),teams=new Set(),displayRows=new Set();
  for(const r of table.rows){
    if(!r||!Number.isSafeInteger(r.position)||r.position<1||r.position>table.totalTeams||(leagueId!==2&&ranks.has(r.position))||typeof r.teamId!=='string'||!r.teamId||teams.has(r.teamId)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100||!Number.isSafeInteger(r.played)||r.played<0||r.played>100||!Number.isSafeInteger(r.goalDifference)||Math.abs(r.goalDifference)>1000||!Number.isSafeInteger(r.points)||Math.abs(r.points)>500||!rasterBase64(r.crest))fail();
    if(leagueId===2){if(!Number.isSafeInteger(r.displayRow)||(r.displayRow??0)<1||(r.displayRow??0)>36||r.position>(r.displayRow??0)||displayRows.has(r.displayRow))fail();displayRows.add(r.displayRow);}
    ranks.add(r.position);teams.add(r.teamId);
  }
  if(leagueId===2&&!selected){const problem=uclOrderProblem(table.rows,table.seasonStart);if(problem)throw new StandingsError('STANDINGS_ORDER',problem+'. Please try later or ask the account owner to review the source.');}
  return table;
}
export function rasterBase64(value:unknown):value is string{
  if(typeof value!=='string'||value.length>700_000||value.length%4!==0||!value.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
  const b=Buffer.from(value,'base64');
  return (b[0]===137&&b.subarray(1,4).toString()==='PNG')||(b[0]===255&&b[1]===216)||(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP');
}
export function selectPositions(table:StandingsTable,positions:number[]):StandingRow[]{
  if(!positions.length||new Set(positions).size!==positions.length)throw new StandingsError('STANDINGS_POSITIONS','Choose at least one unique position.');
  return positions.map(p=>{const row=table.leagueId===2&&Number.isSafeInteger(p)?table.rows[p-1]:table.leagueId===2?undefined:table.rows.find(r=>r.position===p);if(!row)throw new StandingsError('STANDINGS_POSITIONS',table.leagueId===2?`Display row ${p} is unavailable; UCL has 36 rows.`:`Position ${p} is unavailable; this league has ${table.rows.length} teams.`);return row;});
}
export type StandingsProvider={id:string;getCurrentTable:(leagueId:number)=>Promise<StandingsTable>};
// Fixed six-competition key space, one in-flight request per league, no stale fallback.
export function createStandingsService(provider:StandingsProvider|null,now=Date.now){
  const cache=new Map<number,{expires:number;table:StandingsTable}>();
  const inflight=new Map<number,Promise<StandingsTable>>();
  return async(leagueId:number,positions:number[]):Promise<StandingsJob>=>{
    if(!provider)throw new StandingsError('STANDINGS_DISABLED',DISABLED_MESSAGE);
    if(!standingsLeagues.some(l=>l.id===leagueId))throw new StandingsError('STANDINGS_LEAGUE','Choose Premier League, La Liga, Serie A, Bundesliga, Ligue 1 or Champions League.');
    let table=cache.get(leagueId)?.table;
    if(!table||cache.get(leagueId)!.expires<=now()){
      let work=inflight.get(leagueId);
      if(!work){work=Promise.resolve().then(()=>provider.getCurrentTable(leagueId)).then(t=>{validateTable(t,leagueId,now());const copy=structuredClone(t);cache.set(leagueId,{table:copy,expires:Math.min(now()+15*60_000,seasonEndExclusive(t.seasonEnd))});return copy;}).catch(error=>{if(error instanceof StandingsError)throw error;throw new StandingsError('STANDINGS_UNAVAILABLE','The current standings source is unavailable. No historical or example data was substituted.');}).finally(()=>inflight.delete(leagueId));inflight.set(leagueId,work);}
      table=await work;
    }
    validateTable(table,leagueId,now());
    const selected=structuredClone({...table,rows:selectPositions(table,positions)});
    return {layout:'standings',author:'',quote:'',caption:`${standingsLeagues.find(l=>l.id===leagueId)!.name} standings - ${table.seasonStart.slice(0,4)}-${table.seasonEnd.slice(0,4)}\n${table.source}${leagueId===2?'\nSelected UCL display rows: '+positions.join(', ')+'. Shown positions are official ranks, including ties.':''}`,pos:{b:[50,50,1],c:[50,30,1]},standings:selected};
  };
}
export type StandingsPending={kind:'standings';background?:string;leagueId?:number;positions?:number[];ts:number};
export function standingsTransition(msg:{text?:string;caption?:string;photo?:{file_id:string}[];document?:{file_id:string;mime_type?:string}},raw:unknown,now:number):null|{pending:StandingsPending|null;reply:string}|{pending:null;background:string;request:{leagueId:number;positions:number[]};collection:StandingsPending}{
  let p=raw&&typeof raw==='object'&&(raw as StandingsPending).kind==='standings'?raw as StandingsPending:null;
  if(p&&now-p.ts>60*60_000)p=null;
  const file=msg.document?.mime_type?.match(/^image\/(jpeg|png|webp)$/)?msg.document.file_id:msg.photo?.at(-1)?.file_id;
  let text=(msg.text??msg.caption??'').trim();
  const command=/^\/standings(?:@\w+)?(?:\s|$)/i.test(text);
  const direct=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(alias=>text.toLowerCase()===alias||text.toLowerCase().startsWith(alias+' ')||text.toLowerCase().startsWith(alias+'\n'));
  if(!p&&!command){
    if(!direct)return null;
    const selection=text.slice(direct.length).trim();
    if(selection){try{parsePositions(selection);}catch{return null;}}
  }
  if(/^\/cancel(?:@\w+)?$/i.test(text))return {pending:null,reply:'Standings cancelled. Send a new background for a News post.'};
  if(/^\/(help|start)(?:@\w+)?$/i.test(text))return {pending:p,reply:'Standings: send a photo, league and selection numbers, or /cancel to return to News.\n'+UCL_ROW_HELP};
  if(/^\//.test(text)&&!command)return {pending:p,reply:'Finish standings or use /cancel before another News command.'};
  if(command)text=text.replace(/^\/standings(?:@\w+)?\s*/i,'');
  const legacy=raw&&typeof raw==='object'&&(raw as {kind?:string}).kind!=='standings'&&Number.isFinite((raw as {ts?:number}).ts)&&now-((raw as {ts:number}).ts)<=60*60_000&&(raw as {background?:unknown}).background;
  p={...(p??{kind:'standings',ts:now,...(typeof legacy==='string'?{background:legacy}:{})}),ts:now};
  if(file)p.background=file;
  if(text){
    const match=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(alias=>text.toLowerCase()===alias||text.toLowerCase().startsWith(alias+' ')||text.toLowerCase().startsWith(alias+'\n'));
    if(match){p.leagueId=aliases[match];text=text.slice(match.length).trim();}
    else if(!p.leagueId)return {pending:p,reply:'Choose Premier League, La Liga, Serie A, Bundesliga, Ligue 1 or Champions League.'};
    if(text){try{p.positions=parsePositions(text);}catch(e){delete p.positions;return {pending:p,reply:(e as Error).message};}}
  }
  if(!p.background)return {pending:p,reply:'Send the background photo or an image file.'+(p.leagueId===2?'\n'+UCL_ROW_HELP:'')};
  if(!p.leagueId)return {pending:p,reply:'Send the league name.'};
  if(!p.positions)return {pending:p,reply:p.leagueId===2?UCL_ROW_HELP+'\nSend display row numbers, for example: 28 29 30 31.':'Send positions, for example: 1 2 3.'};
  return {pending:null,background:p.background,request:{leagueId:p.leagueId,positions:p.positions},collection:p};
}
