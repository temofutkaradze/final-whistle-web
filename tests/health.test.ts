import {beforeEach,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/db',()=>({prisma:{$queryRaw:query}}));
import {GET} from '@/app/api/health/route';
beforeEach(()=>{vi.resetAllMocks();});
it('reports ready only when the required authentication and pairing schema exists',async()=>{
 query.mockResolvedValue([{ready:true}]);const response=await GET();expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,database:'connected'});
 const sql=(query.mock.calls[0][0] as TemplateStringsArray).join('');for(const name of ['AuthIdentity','MatchPairingChallenge','MatchTelegramBinding'])expect(sql).toContain(name);expect(sql).toContain('to_regclass');
});
it('reports unavailable for missing required tables or an empty readiness result',async()=>{
 for(const rows of [[{ready:false}],[]]){query.mockResolvedValueOnce(rows);const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,database:'schema_incomplete'});}
});
it('does not expose database errors or credentials',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});query.mockRejectedValueOnce(Error('sensitive database detail'));const response=await GET();expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('sensitive');vi.restoreAllMocks();
});
