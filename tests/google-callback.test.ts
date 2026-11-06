import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),set:vi.fn(),exchange:vi.fn(),resolve:vi.fn(),session:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:mocks.get,set:mocks.set})}));
vi.mock('next/navigation',()=>({redirect:(destination:string)=>{throw Object.assign(new Error('Redirect'),{destination});}}));
vi.mock('@/lib/auth',()=>({createSession:mocks.session}));
vi.mock('@/lib/google-auth',()=>({resolveGoogleUser:mocks.resolve}));
vi.mock('@/lib/google',async importOriginal=>({...await importOriginal<typeof import('@/lib/google')>(),exchangeCodeForProfile:mocks.exchange}));
import {GET} from '@/app/auth/google/callback/route';
const request=(query='code=test-code&state=test-state')=>new Request('https://app.invalid/auth/google/callback?'+query);
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('GOOGLE_CLIENT_ID','test-id');vi.stubEnv('GOOGLE_CLIENT_SECRET','test-secret');vi.stubEnv('APP_URL','https://app.invalid');
 vi.spyOn(console,'error').mockImplementation(()=>{});mocks.get.mockReturnValue({value:'test-state.test-verifier'});
 mocks.exchange.mockResolvedValue({subject:'verified-subject',email:'owner@example.com',name:'Owner'});mocks.resolve.mockResolvedValue({ok:true,userId:'subject-owner'});mocks.session.mockResolvedValue(undefined);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('Google callback identity boundary',()=>{
 it('creates a session only for the resolved provider subject owner',async()=>{
  await expect(GET(request('code=test-code&state=test-state&userId=attacker&link=true'))).rejects.toMatchObject({destination:'/dashboard'});
  expect(mocks.resolve).toHaveBeenCalledWith({subject:'verified-subject',email:'owner@example.com',name:'Owner'});expect(mocks.session).toHaveBeenCalledExactlyOnceWith('subject-owner');
  expect(mocks.set).toHaveBeenCalledWith('fw_oauth','',{path:'/auth/google',maxAge:0});
 });
 it.each(['state=bad&code=x','state=test-state','error=access_denied&state=test-state&code=x'])('rejects invalid OAuth context before account lookup: %s',async query=>{
  await expect(GET(request(query))).rejects.toMatchObject({destination:'/login?error=google'});expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it('rejects missing OAuth cookie',async()=>{
  mocks.get.mockReturnValue(undefined);await expect(GET(request())).rejects.toMatchObject({destination:'/login?error=google'});expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it('does not authenticate when Google rejects verification or provider identity',async()=>{
  mocks.exchange.mockRejectedValueOnce(new Error('Invalid verified profile'));await expect(GET(request())).rejects.toMatchObject({destination:'/login?error=google'});expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it('fails closed for legacy/email/identity conflicts instead of creating a session',async()=>{
  mocks.resolve.mockResolvedValueOnce({ok:false,reason:'account_conflict'});await expect(GET(request())).rejects.toMatchObject({destination:'/login?error=google_account'});expect(mocks.session).not.toHaveBeenCalled();
 });
 it('fails closed on missing identity table and database errors',async()=>{
  mocks.resolve.mockRejectedValueOnce(Object.assign(new Error('Private database details'),{code:'P2021'}));await expect(GET(request())).rejects.toMatchObject({destination:'/login?error=google'});expect(mocks.session).not.toHaveBeenCalled();expect(console.error).toHaveBeenCalledWith('Google identity resolution failed.');
 });
 it('does not advertise successful login if session creation fails',async()=>{
  mocks.session.mockRejectedValueOnce(new Error('Session unavailable'));await expect(GET(request())).rejects.toThrow('Session unavailable');
 });
});
