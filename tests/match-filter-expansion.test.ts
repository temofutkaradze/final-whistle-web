import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({require:vi.fn(),find:vi.fn(),create:vi.fn(),update:vi.fn(),removeFavorites:vi.fn(),favorites:vi.fn(),teams:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireUser:m.require,clearSessionCookie:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{subscription:{findFirst:m.find,create:m.create,update:m.update},favoriteTeam:{deleteMany:m.removeFavorites,createMany:m.favorites},team:{findMany:m.teams}}}));
vi.mock('next/navigation',()=>({redirect:(destination:string)=>{throw Object.assign(Error('redirect'),{destination});}}));
import {saveFilters} from '@/features/match/dashboard/actions';
beforeEach(()=>{vi.resetAllMocks();m.require.mockResolvedValue({id:'owner'});m.find.mockResolvedValue(null);m.teams.mockResolvedValue([]);});
const form=()=>{const f=new FormData();for(const id of ['39','3','999999'])f.append('leagues',id);for(const id of ['26','6','9568','999999'])f.append('teams',id);f.set('userId','attacker');return f;};
it('saves validated Europa and exact featured favorites before Team metadata is downloaded',async()=>{
 await expect(saveFilters(form())).rejects.toMatchObject({destination:'/dashboard/match?saved=1'});
 expect(m.create).toHaveBeenCalledWith({data:{userId:'owner',leagueIds:[39,3]}});
 expect(m.favorites).toHaveBeenCalledWith({data:[26,6,9568].map(teamId=>({userId:'owner',teamId})),skipDuplicates:true});
});
it('preserves existing stored favorites and scopes preference changes to the authenticated principal',async()=>{
 m.require.mockResolvedValue({id:'second-user'});m.find.mockResolvedValue({id:'second-sub'});m.teams.mockResolvedValue([{id:100},{id:26}]);
 await expect(saveFilters(form())).rejects.toMatchObject({destination:'/dashboard/match?saved=1'});
 expect(m.find).toHaveBeenCalledWith({where:{userId:'second-user'},orderBy:{createdAt:'desc'}});
 expect(m.update).toHaveBeenCalledWith({where:{id:'second-sub'},data:{leagueIds:[39,3]}});
 expect(m.removeFavorites).toHaveBeenCalledWith({where:{userId:'second-user'}});
 expect(m.favorites.mock.calls[0][0].data).toEqual([100,26,6,9568].map(teamId=>({userId:'second-user',teamId})));
});
