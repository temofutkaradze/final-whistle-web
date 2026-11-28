import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({cache:new Set<string>(),rows:new Map<number,any>(),fixtures:[] as any[],usage:0}));
vi.mock('../scripts/lib/db.mjs',()=>({prisma:{
 fixtureDay:{findUnique:async({where}:any)=>state.cache.has(where.date)?{date:where.date}:null,upsert:async({where}:any)=>state.cache.add(where.date)},
 match:{upsert:vi.fn(async({where,create,update}:any)=>state.rows.set(where.fixtureId,state.rows.has(where.fixtureId)?{...state.rows.get(where.fixtureId),...update}:create))},
 team:{upsert:vi.fn()},apiUsage:{upsert:async()=>({count:++state.usage})},
}}));
import {ensureDay,apiGet} from '../scripts/lib/football.mjs';
const raw=(id:number,team=9568,league=253)=>({fixture:{id,date:'2026-12-31T22:30:00Z',status:{short:'NS'}},league:{id:league,name:'SYNTHETIC official cup',logo:'https://example.invalid/league.png'},teams:{home:{id:team,name:'MOCK home',logo:'https://example.invalid/home.png'},away:{id:99002,name:'MOCK away',logo:'https://example.invalid/away.png'}},goals:{home:null,away:null}});
beforeEach(()=>{state.cache.clear();state.rows.clear();state.usage=0;state.fixtures=[];vi.clearAllMocks();vi.stubEnv('API_FOOTBALL_KEY','mock-key-not-live');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({response:state.fixtures,errors:[]})})));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('reuses broad responses, deduplicates overlaps and concurrent users, and persists the policy cache',async()=>{
 state.fixtures=[raw(1),raw(1),raw(2,26,1),raw(3,6,10),raw(4,99001,3),raw(5,99001,39),raw(6,99001,253)];
 await Promise.all([ensureDay('2026-12-31'),ensureDay('2026-12-31')]);
 expect(fetch).toHaveBeenCalledTimes(1);expect(state.usage).toBe(1);expect([...state.rows.keys()]).toEqual([1,2,3,4,5]);
 expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/fixtures\?date=2026-12-31$/);
 await ensureDay('2026-12-31');expect(fetch).toHaveBeenCalledTimes(1);
 expect([...state.cache][0]).toMatch(/\|coverage-v1$/);
});
it('refreshes a legacy policy once without deleting historical records or making team-specific requests',async()=>{
 state.cache.add('utc:2026-12-31|2,5,39,61,78,135,140');state.rows.set(9,{fixtureId:9,eventsJson:['retained']});state.fixtures=[raw(1)];
 await ensureDay('2026-12-31');await ensureDay('2026-12-31');
 expect(fetch).toHaveBeenCalledTimes(1);expect(state.rows.get(9).eventsJson).toEqual(['retained']);expect(state.cache.size).toBe(2);
});
it('charges only missing UTC dates: two cold, zero warm, and one new date the next Tbilisi day',async()=>{
 await ensureDay('2026-12-30');await ensureDay('2026-12-31');expect(fetch).toHaveBeenCalledTimes(2);
 await ensureDay('2026-12-30');await ensureDay('2026-12-31');expect(fetch).toHaveBeenCalledTimes(2);
 await ensureDay('2026-12-31');await ensureDay('2027-01-01');expect(fetch).toHaveBeenCalledTimes(3);
});
it('preserves the 90-request gate and does not contact the provider above it',async()=>{
 state.usage=89;await apiGet('fixtures',{date:'2026-12-31'});expect(fetch).toHaveBeenCalledTimes(1);
 await expect(apiGet('fixtures',{date:'2026-12-31'})).rejects.toThrow('limit reached (90)');expect(fetch).toHaveBeenCalledTimes(1);
});
