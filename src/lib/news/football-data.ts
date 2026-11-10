// Server-side only. No API-Football calls and no paid or historical fallback.
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { downloadPublicResource } from '../../../render/security.js';
import { footballDataCodes, mapFootballData, isOverallStanding } from './standings-adapters.ts';
import { StandingsError, validTeamCount, type StandingsProvider } from './standings.ts';
const require=createRequire(import.meta.url);
const {validateMatchImage}=require('../../../render/security.js') as {validateMatchImage:(b:Buffer)=>Promise<{format:string;width:number;height:number;pages:number}>};
const ORIGIN='https://api.football-data.org';
const unavailable=()=>new StandingsError('STANDINGS_UNAVAILABLE','Current standings are unavailable. No historical or sample table was substituted. Please try later.');
const rateLimited=()=>new StandingsError('STANDINGS_RATE_LIMIT','The free standings API rate limit is reached. Please try again in a minute.');
type Team={id:number;name:string;crest:string};
type Season={id:number;startDate:string;endDate:string};
type Total={type:string;stage:string;group?:string|null;table:{position:number;team:Team;playedGames:number;goalDifference:number;points:number}[]};
type StandingResponse={competition:{code:string;emblem:string};season:Season;standings:Total[]};
type TeamsResponse={count:number;season:Season;competition:{code:string};teams:Team[]};
type Options={apiKey?:string;fetchImpl?:typeof fetch;now?:()=>number;download?:typeof downloadPublicResource};
export function createFootballDataProvider({apiKey,fetchImpl=fetch,now=Date.now,download=downloadPublicResource}:Options):StandingsProvider|null{
  if(!apiKey?.trim())return null;
  const key=apiKey.trim();
  const admissions:number[]=[];
  const assets=new Map<string,{expires:number;value:string}>();
  let activeTables=0,blockedUntil=0;
  async function request<T>(code:string,resource:'standings'|'teams',deadline:number):Promise<T>{
    const time=now();
    while(admissions.length&&admissions[0]<=time-60_000)admissions.shift();
    if(time<blockedUntil||admissions.length>=10)throw rateLimited();
    if(time>=deadline)throw unavailable();
    admissions.push(time); // Concurrency-safe synchronous admission; failed calls still count.
    const response=await fetchImpl(`${ORIGIN}/v4/competitions/${code}/${resource}`,{headers:{'X-Auth-Token':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(15_000,deadline-time)))});
    if(response.status===429){
      const retry=response.headers.get('retry-after');
      const seconds=retry&&/^\d+$/.test(retry)?Number(retry):null;
      const until=seconds!==null?now()+Math.min(seconds,86400)*1000:retry?Date.parse(retry):NaN;
      blockedUntil=Math.max(blockedUntil,Number.isFinite(until)?Math.max(now()+60_000,until):now()+60_000);
      await response.body?.cancel();throw rateLimited();
    }
    if(!response.ok){await response.body?.cancel();if([401,403].includes(response.status))throw new StandingsError('STANDINGS_AUTH','The standings API key or free-plan access was rejected. Ask the account owner to check its configuration.');throw unavailable();}
    if(!/application\/json/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw unavailable();}
    const reader=response.body?.getReader();if(!reader)throw unavailable();
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512*1024){await reader.cancel();throw unavailable();}chunks.push(value);}}
    finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;}catch{throw unavailable();}
  }
  function assetUrl(value:string):string{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='crests.football-data.org'||url.port||url.username||url.password||url.search||url.hash||!/^\/[a-zA-Z0-9_-]+\.(png|svg|jpe?g|webp)$/i.test(url.pathname))throw unavailable();
    return url.href;
  }
  async function raster(value:string,deadline:number):Promise<string>{
    const url=assetUrl(value),time=now();
    const cached=assets.get(url);if(cached&&cached.expires>time)return cached.value;
    if(time>=deadline)throw unavailable();
    const result=await download(url,{maxBytes:512*1024,timeoutMs:Math.max(1,Math.min(8000,deadline-time))});
    // Reuse existing APNG/SVG/resource validation before any Sharp rasterization.
    const metadata=await validateMatchImage(result.body);
    if(!['png','jpeg','webp','svg'].includes(metadata.format)||metadata.pages!==1||metadata.width>2048||metadata.height>2048)throw unavailable();
    const png=await sharp(result.body,{limitInputPixels:2048*2048}).rotate().resize({width:256,height:256,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    if(png.length>500_000)throw unavailable();
    for(const [entry,item] of assets)if(item.expires<=time)assets.delete(entry);
    if(assets.size>=128)assets.delete(assets.keys().next().value!);
    const encoded=png.toString('base64');assets.set(url,{expires:now()+60*60_000,value:encoded});return encoded;
  }
  return {id:'football-data.org',async getCurrentTable(leagueId){
    const code=footballDataCodes[leagueId];if(!code)throw unavailable();
    if(activeTables>=2)throw new StandingsError('STANDINGS_BUSY','The standings source is busy. Please try again shortly.');
    activeTables++;const deadline=now()+45_000;
    try{
      const data=await request<StandingResponse>(code,'standings',deadline);
      const totals=Array.isArray(data?.standings)?data.standings.filter(t=>isOverallStanding(leagueId,t)):[];
      if(data?.competition?.code!==code||totals.length!==1||!Array.isArray(totals[0].table))throw unavailable();
      const rows=totals[0].table;
      const teams=await request<TeamsResponse>(code,'teams',deadline);
      const time=now(),start=Date.parse(data.season?.startDate),end=Date.parse(data.season?.endDate);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>time||end<time||end<=start||end-start>400*86400_000||!Number.isSafeInteger(data.season?.id)||teams?.competition?.code!==code||teams.season?.id!==data.season.id||teams.season.startDate!==data.season.startDate||teams.season.endDate!==data.season.endDate||!Array.isArray(teams.teams)||!validTeamCount(leagueId,teams.count)||teams.count!==teams.teams.length||rows.length!==teams.count)throw unavailable();
      // Do not invent ordinal ranks for shared/duplicated provider positions.
      const ranks=new Set(rows.map(r=>r.position));
      if(ranks.size!==teams.count||rows.some(r=>!Number.isSafeInteger(r.position)||r.position<1||r.position>teams.count))throw new StandingsError('STANDINGS_DATA','The standings source returned duplicate or missing positions. Please try later; no ranks were renumbered.');
      const teamIds=new Set(teams.teams.map(t=>t.id));
      if(teamIds.size!==teams.count||[...teamIds].some(id=>!Number.isSafeInteger(id)||id<1)||new Set(rows.map(r=>r.team?.id)).size!==teams.count||rows.some(r=>!teamIds.has(r.team?.id)))throw unavailable();
      const crests:Record<string,string>={};
      const leagueLogo=await raster(data.competition.emblem,deadline);
      for(const row of rows)crests[String(row.team.id)]=await raster(row.team.crest,deadline);
      return mapFootballData(data,leagueId,teams.count,{leagueLogo,teamCrests:crests},now());
    }catch(error){if(error instanceof StandingsError)throw error;throw unavailable();}
    finally{activeTables--;}
  }};
}
