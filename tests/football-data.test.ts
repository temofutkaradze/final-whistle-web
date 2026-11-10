import {describe,it,expect,vi} from 'vitest';
import {createFootballDataProvider} from '../src/lib/news/football-data';
import {createStandingsService} from '../src/lib/news/standings';
import {fictionalTable} from './standings-fixture';

async function fixture(leagueId=39){
  let clock=Date.now();const t=await fictionalTable(leagueId,clock);
  const raw={competition:{code:leagueId===2?'CL':'PL',emblem:leagueId===2?'https://crests.football-data.org/CL.png':'https://crests.football-data.org/PL.png'},season:{id:123,startDate:t.seasonStart,endDate:t.seasonEnd},standings:[{type:'TOTAL',stage:leagueId===2?'LEAGUE_STAGE':'REGULAR_SEASON',group:leagueId===2?'League phase':'Matchday',table:t.rows.map(r=>({position:r.position,team:{id:Number(r.teamId),name:r.name,crest:`https://crests.football-data.org/${r.teamId}.png`},playedGames:r.played,goalDifference:r.goalDifference,points:r.points}))}]};
  const teams={count:t.totalTeams,competition:{code:leagueId===2?'CL':'PL'},season:{...raw.season},teams:raw.standings[0].table.map(r=>r.team)};
  const fetchImpl=vi.fn(async(url:unknown,_init?:RequestInit)=>{const u=new URL(String(url)),code=u.pathname.split('/')[3];const value=structuredClone(u.pathname.endsWith('/teams')?teams:raw);value.competition.code=code;return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});});
  const download=vi.fn(async(_url:string,_options?:unknown)=>({body:Buffer.from(t.leagueLogo,'base64'),contentType:'image/png',headers:{}}));
  const provider=()=>createFootballDataProvider({apiKey:'fictional-test-key',fetchImpl:fetchImpl as typeof fetch,download,now:()=>clock})!;
  return {t,raw,teams,fetchImpl,download,provider,tick:(ms:number)=>clock+=ms};
}
describe('football-data.org current-season provider (mocked HTTP only)',()=>{
  it('requires a server-side key; missing/blank keys do not call any API',()=>{expect(createFootballDataProvider({})).toBeNull();expect(createFootballDataProvider({apiKey:' '})).toBeNull();});
  it('accepts the verified Matchday TOTAL shape and all ranks including 15-18',async()=>{const f=await fixture();const table=await f.provider().getCurrentTable(39);expect(table.rows).toHaveLength(20);expect(table.rows.slice(14,18).map(r=>r.position)).toEqual([15,16,17,18]);expect(f.fetchImpl).toHaveBeenCalledTimes(2);expect(f.fetchImpl.mock.calls[0][1]).toMatchObject({redirect:'error',headers:{'X-Auth-Token':'fictional-test-key'}});expect(table.source).toContain('Football-Data.org API');expect(f.download.mock.calls.every(c=>!(c[1] as {headers?:unknown})?.headers)).toBe(true);});
  it('shares the 15-minute table cache and supports a single selected position',async()=>{const f=await fixture();const service=createStandingsService(f.provider());const jobs=await Promise.all([service(39,[18,15]),service(39,[1])]);expect(jobs[0].standings.rows.map(r=>r.position)).toEqual([18,15]);expect(jobs[1].standings.rows).toHaveLength(1);expect(f.fetchImpl).toHaveBeenCalledTimes(2);});
  it('maps all five league codes and accepts actual 18-team leagues',async()=>{
    for(const [leagueId,count] of [[39,20],[140,20],[135,20],[78,18],[61,18]]){
      const f=await fixture();f.raw.standings[0].table=f.raw.standings[0].table.slice(0,count);f.teams.teams=f.teams.teams.slice(0,count);f.teams.count=count;
      const table=await f.provider().getCurrentTable(leagueId);expect(table.leagueId).toBe(leagueId);expect(table.totalTeams).toBe(count);expect(table.rows.at(-1)?.position).toBe(count);
    }
  });
  it('keeps credentials off artwork requests and caches normalized raster assets',async()=>{const f=await fixture();const p=f.provider();await p.getCurrentTable(39);const count=f.download.mock.calls.length;await p.getCurrentTable(39);expect(f.download).toHaveBeenCalledTimes(count);expect(f.download.mock.calls[0][0]).toBe('https://crests.football-data.org/PL.png');});
  it('enforces concurrency-safe 10/minute admission without a queue or automatic retry',async()=>{const f=await fixture();const p=f.provider();for(let i=0;i<5;i++)await p.getCurrentTable(39);await expect(p.getCurrentTable(39)).rejects.toMatchObject({code:'STANDINGS_RATE_LIMIT'});expect(f.fetchImpl).toHaveBeenCalledTimes(10);f.tick(60_001);await p.getCurrentTable(39);expect(f.fetchImpl).toHaveBeenCalledTimes(12);});
  it('honors a 429 Retry-After and does not issue another request during cooldown',async()=>{const f=await fixture();f.fetchImpl.mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'120'}}));const p=f.provider();await expect(p.getCurrentTable(39)).rejects.toMatchObject({code:'STANDINGS_RATE_LIMIT'});f.tick(61_000);await expect(p.getCurrentTable(39)).rejects.toMatchObject({code:'STANDINGS_RATE_LIMIT'});expect(f.fetchImpl).toHaveBeenCalledTimes(1);f.tick(60_000);await p.getCurrentTable(39);expect(f.fetchImpl).toHaveBeenCalledTimes(3);});
  for(const status of [401,403,404,500])it('sanitizes HTTP '+status+' without exposing response bodies',async()=>{const f=await fixture();f.fetchImpl.mockResolvedValueOnce(new Response('sensitive-provider-body',{status}));await expect(f.provider().getCurrentTable(39)).rejects.not.toThrow('sensitive-provider-body');expect(f.fetchImpl).toHaveBeenCalledTimes(1);expect(f.download).not.toHaveBeenCalled();});
  it('rejects malformed and oversized API responses',async()=>{for(const response of [new Response('not json',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}})]){const f=await fixture();f.fetchImpl.mockResolvedValueOnce(response);await expect(f.provider().getCurrentTable(39)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();}});
  it('refuses missing teams, ambiguous TOTALs and historical season data',async()=>{for(const mutation of [(f:Awaited<ReturnType<typeof fixture>>)=>f.raw.standings.push(f.raw.standings[0]),(f:Awaited<ReturnType<typeof fixture>>)=>{f.teams.count=19;},(f:Awaited<ReturnType<typeof fixture>>)=>{f.teams.teams[0]={...f.teams.teams[0],id:999};},(f:Awaited<ReturnType<typeof fixture>>)=>{f.teams.season.id=999;},(f:Awaited<ReturnType<typeof fixture>>)=>{f.raw.season.endDate='2020-01-01';}]){const f=await fixture();mutation(f);await expect(f.provider().getCurrentTable(39)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();}});
  it('rejects external/private artwork URLs and unsafe SVG resources',async()=>{for(const url of ['http://127.0.0.1/PL.png','https://example.com/PL.png','https://crests.football-data.org/PL.png?token=anything','https://crests.football-data.org:444/PL.png']){const f=await fixture();f.raw.competition.emblem=url;await expect(f.provider().getCurrentTable(39)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();}const f=await fixture();f.raw.competition.emblem='https://crests.football-data.org/PL.svg';f.download.mockResolvedValueOnce({body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><image href="http://127.0.0.1/x"/></svg>'),contentType:'image/svg+xml',headers:{}});await expect(f.provider().getCurrentTable(39)).rejects.toThrow('unavailable');});
  it('admits at most two concurrent table loads and releases after failure',async()=>{const f=await fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const base=f.fetchImpl.getMockImplementation()!;f.fetchImpl.mockImplementation(async(...args)=>{await gate;return base(...args);});const p=f.provider();const a=p.getCurrentTable(39),b=p.getCurrentTable(140);await expect(p.getCurrentTable(135)).rejects.toMatchObject({code:'STANDINGS_BUSY'});release();await Promise.all([a,b]);await p.getCurrentTable(135);});
});

describe('Champions League overall league-phase provider',()=>{
  it('retrieves every true rank 1-36 and preserves arbitrary selected order',async()=>{
    const f=await fixture(2);const service=createStandingsService(f.provider());
    const all=await service(2,Array.from({length:36},(_,i)=>i+1));expect(all.standings.rows.map(r=>r.position)).toEqual(Array.from({length:36},(_,i)=>i+1));
    for(const positions of [[1,2,3],[9,10,11,12],[24,25,26],[36,33,35,34]])expect((await service(2,positions)).standings.rows.map(r=>r.position)).toEqual(positions);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    for(const positions of [[37],[0],[-1],[1.5]])await expect(service(2,positions)).rejects.toThrow('Position');
  });
  it('blocks the observed 36-row response with duplicate 29 and missing 30, without downloading or renumbering',async()=>{
    const f=await fixture(2);f.raw.standings[0].table[29].position=29;
    await expect(f.provider().getCurrentTable(2)).rejects.toMatchObject({code:'STANDINGS_DATA'});
    expect(f.raw.standings[0].table[29].position).toBe(29);expect(f.download).not.toHaveBeenCalled();
  });
  it('rejects truncated 35-team metadata even when its row count matches',async()=>{
    const f=await fixture(2);f.raw.standings[0].table.pop();f.teams.teams.pop();f.teams.count=35;
    await expect(f.provider().getCurrentTable(2)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();
  });
  for(const stage of ['GROUP_STAGE','LAST_16','QUARTER_FINALS','FINAL','REGULAR_SEASON'])it('rejects non-league-phase stage '+stage,async()=>{
    const f=await fixture(2);f.raw.standings[0].stage=stage;
    await expect(f.provider().getCurrentTable(2)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();
  });
  it('rejects group tables, HOME-only tables, multiple totals and historical seasons',async()=>{
    for(const change of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.raw.standings[0].group='Group A';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.raw.standings[0].type='HOME';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.raw.standings.push(f.raw.standings[0]);},(f:Awaited<ReturnType<typeof fixture>>)=>{f.raw.season.endDate='2024-01-01';}]){
      const f=await fixture(2);change(f);await expect(f.provider().getCurrentTable(2)).rejects.toThrow('unavailable');expect(f.download).not.toHaveBeenCalled();
    }
  });
});
