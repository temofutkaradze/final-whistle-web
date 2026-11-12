import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createFakeDb} from './helpers/fake-prisma';
import {listAvailableMatches,filterMatchList} from '../scripts/lib/match-list.mjs';
import {localDayRange,refreshStatuses} from '../scripts/lib/football.mjs';
import {checkpointFromFixture,isLiveCheckpoint} from '../scripts/lib/live-checkpoint.mjs';
import {toggleSelection} from '../scripts/lib/selection.mjs';
import {assignPendingBackground} from '../scripts/lib/background-files.mjs';
import path from 'node:path';

const mocked=vi.hoisted(()=>({prisma:{} as any}));
vi.mock('../scripts/lib/db.mjs',()=>({get prisma(){return mocked.prisma;}}));
const at=(time:string)=>new Date(`2026-11-13T${time}:00+04:00`);
let db:ReturnType<typeof createFakeDb>;
beforeEach(()=>{db=createFakeDb({now:at('00:30').getTime()});mocked.prisma=db.prisma;});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});

describe('cached cross-midnight list',()=>{
  beforeEach(()=>{
    db.tables.match.push({fixtureId:1,day:'2026-11-12',kickoff:new Date('2026-11-12T23:00:00+04:00'),leagueId:39,homeTeam:'Alpha',awayTeam:'Beta',homeTeamId:1,awayTeamId:2},
      {fixtureId:2,day:'2026-11-13',kickoff:at('00:05'),leagueId:140,homeTeam:'Gamma',awayTeam:'Delta',homeTeamId:3,awayTeamId:4});
  });
  it.each(['00:00','00:30','02:00','02:59','03:00','03:01'])('handles the inclusive boundary at %s without fetching another day',async time=>{
    const ensureDay=vi.fn();const now=at(time);
    const rows=await listAvailableMatches({prisma:db.prisma,ensureDay,localDayRange:(ignored:unknown,d:Date)=>localDayRange('Asia/Tbilisi',d),now});
    expect(rows.map(r=>r.fixtureId)).toEqual(time==='03:01'?[2]:[1,2]);
    expect(ensureDay.mock.calls).toEqual([['2026-11-13']]);
    expect(new Set(rows.map(r=>r.fixtureId)).size).toBe(rows.length);
  });
  it('keeps current-day fixtures even after four hours; preserves filters, favorites, search and UTC/local boundaries',async()=>{
    const rows=await listAvailableMatches({prisma:db.prisma,ensureDay:vi.fn(),localDayRange:(ignored:unknown,d:Date)=>localDayRange('Asia/Tbilisi',d),now:at('20:00')});
    expect(rows.map(r=>r.fixtureId)).toEqual([2]);
    const all=db.tables.match;
    expect(filterMatchList(all,{leagues:new Set([39]),teams:new Set()},null).map(r=>r.fixtureId)).toEqual([1]);
    expect(filterMatchList(all,{leagues:new Set([39]),teams:new Set([3])},'gamma').map(r=>r.fixtureId)).toEqual([2]);
    const utc=await listAvailableMatches({prisma:db.prisma,ensureDay:vi.fn(),localDayRange:(ignored:unknown,d:Date)=>localDayRange('UTC',d),now:at('00:30')});
    expect(utc.map(r=>r.fixtureId)).toEqual([1,2]);
  });
  it('selects a previous-day fixture and assigns its pending background with the unchanged helpers',async()=>{
    const file=path.resolve('storage/backgrounds/cross-midnight.jpg');db.tables.user.push({id:'u',pendingBackgroundPath:file});
    expect(await toggleSelection({prisma:db.prisma,userId:'u',fixtureId:1,maxAgeHours:24,now:at('00:30').getTime()})).toEqual({result:'selected'});
    expect(await assignPendingBackground(db.prisma,'u',file,1)).toEqual({count:1});
    expect(db.tables.selection[0]).toMatchObject({fixtureId:1,status:'SELECTED',backgroundPath:file});
  });
  it('does not leak an older previous local-day match through a matching UTC cache day',async()=>{
    db.tables.match.length=0;
    db.tables.match.push({fixtureId:9,day:'2026-11-13',kickoff:new Date('2026-11-12T20:00:00-05:00')},
      {fixtureId:10,day:'2026-11-13',kickoff:new Date('2026-11-13T00:15:00-05:00')});
    const ensureDay=vi.fn();
    const rows=await listAvailableMatches({prisma:db.prisma,ensureDay,localDayRange:(_:unknown,d:Date)=>localDayRange('America/New_York',d),now:new Date('2026-11-13T03:01:00-05:00')});
    expect(rows.map(r=>r.fixtureId)).toEqual([10]);expect(ensureDay.mock.calls).toEqual([['2026-11-13']]);
  });
});

describe('actual provider response processing',()=>{
  it('does not partially advance a status check when saving its checkpoint fails',async()=>{
    vi.stubEnv('API_FOOTBALL_KEY','test-only');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({response:[{fixture:{id:1,status:{short:'2H',elapsed:90}},goals:{home:2,away:1}}]})})));
    db.prisma.apiUsage.upsert=vi.fn(async()=>({count:1}));db.tables.match.push({fixtureId:1,statusShort:'NS',lastCheckedAt:null,liveCheckpointAt:null});
    db.failNext('match','updateMany',new Error('checkpoint write failed'));
    await expect(refreshStatuses('2026-11-12',[{fixtureId:1}])).rejects.toThrow('checkpoint write failed');
    expect(db.tables.match[0]).toMatchObject({statusShort:'NS',lastCheckedAt:null,liveCheckpointAt:null});
  });
  it('uses one existing fixture request, retains elapsed/extra and freezes the first live score',async()=>{
    vi.stubEnv('API_FOOTBALL_KEY','test-only');vi.useFakeTimers();vi.setSystemTime(at('00:30'));
    const f={fixture:{id:1,status:{short:'2H',elapsed:90,extra:3}},goals:{home:2,away:1}};
    const fetcher=vi.fn(async(_url:unknown)=>({ok:true,json:async()=>({response:[f],errors:[]})}));vi.stubGlobal('fetch',fetcher);
    db.prisma.apiUsage.upsert=vi.fn(async()=>({count:1}));db.tables.match.push({fixtureId:1,liveCheckpointAt:null});
    await refreshStatuses('2026-11-12',[{fixtureId:1}]);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0]?.[0])).toContain('fixtures?date=2026-11-12');
    expect(db.tables.match[0]).toMatchObject({elapsedMinutes:90,extraMinutes:3,liveCheckpointJson:{homeScore:2,awayScore:1,elapsed:90,extra:3}});
    f.goals.away=2;f.fixture.status.extra=5;await refreshStatuses('2026-11-12',[{fixtureId:1}]);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(db.tables.match[0].liveCheckpointJson.awayScore).toBe(1);
    f.fixture.status.short='FT';await refreshStatuses('2026-11-12',[{fixtureId:1}]);
    expect(fetcher).toHaveBeenCalledTimes(3);expect(db.tables.match[0].statusShort).toBe('FT');
    expect(db.tables.match[0].liveCheckpointJson.awayScore).toBe(1);
  });
  it.each(['NS','1H','HT','BT','P','FT','AET','PEN','PST','CANC','LIVE'])('never treats %s as eligible even at 120',status=>{
    expect(isLiveCheckpoint(status,120)).toBe(false);
  });
  it('requires real integer playing minutes and valid scores, permits ET, and does not add stoppage to 88',()=>{
    expect(isLiveCheckpoint('2H',88)).toBe(false);expect(isLiveCheckpoint('ET',105)).toBe(true);
    for(const elapsed of [null,undefined,'90',NaN,89.5])expect(isLiveCheckpoint('2H',elapsed)).toBe(false);
    expect(checkpointFromFixture({fixture:{status:{short:'2H',elapsed:88,extra:5}},goals:{home:2,away:1}},at('00:30'))).toBeNull();
    expect(checkpointFromFixture({fixture:{status:{short:'2H',elapsed:90}},goals:{home:null,away:1}},at('00:30'))).toBeNull();
  });
});

it('prepares an additive bounded migration without destructive statements or automatic execution',()=>{
  const sql=readFileSync('prisma/match-checkpoints.sql','utf8');
  expect(sql).toContain('SET LOCAL lock_timeout');expect(sql).toContain('SET "selectedAt" = "createdAt"');
  expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/);expect(sql).toContain('COMMIT;');
});
