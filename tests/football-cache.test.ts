import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({day:vi.fn(async()=>null),mark:vi.fn(),team:vi.fn(),match:vi.fn(),usage:vi.fn(async()=>({count:1}))}));
vi.mock('../scripts/lib/db.mjs',()=>({prisma:{fixtureDay:{findUnique:mocks.day,upsert:mocks.mark},team:{upsert:mocks.team},match:{upsert:mocks.match},apiUsage:{upsert:mocks.usage}}}));
import {ensureDay} from '../scripts/lib/football.mjs';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('writes each team once per day load and shares simultaneous requests',async()=>{
  vi.stubEnv('API_FOOTBALL_KEY','test');
  const team=(id:number)=>({id,name:'Team '+id,logo:'logo'});
  const fixtures=[1,2].map(id=>({fixture:{id,date:'2026-11-17T12:00:00Z',status:{short:'NS'}},league:{id:39,name:'League',logo:'logo'},teams:{home:team(1),away:team(id+1)},goals:{home:null,away:null}}));
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({response:fixtures})}));vi.stubGlobal('fetch',fetcher);
  await Promise.all([ensureDay('2026-11-17'),ensureDay('2026-11-17')]);
  expect(fetcher).toHaveBeenCalledOnce();expect(mocks.match).toHaveBeenCalledTimes(2);expect(mocks.team).toHaveBeenCalledTimes(3);expect(mocks.mark).toHaveBeenCalledOnce();
});
