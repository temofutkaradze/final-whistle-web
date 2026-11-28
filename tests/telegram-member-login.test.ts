import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),member:vi.fn()}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:'mock-session-token'})})}));
vi.mock('next/navigation',()=>({redirect:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{session:{findUnique:mocks.session},telegramMember:{findUnique:mocks.member}}}));
import {getCurrentUser} from '@/lib/auth';
beforeEach(()=>{vi.resetAllMocks();});
it('preserves normal website owner authentication without membership queries',async()=>{
 const owner={id:'owner',email:'owner@example.test'};mocks.session.mockResolvedValue({user:owner,expiresAt:new Date(Date.now()+60000)});
 expect(await getCurrentUser()).toBe(owner);expect(mocks.member).not.toHaveBeenCalled();
});
it('does not allow Telegram-only principals to authenticate as website administrators',async()=>{
 mocks.session.mockResolvedValue({user:{id:'principal',email:'random@telegram.invalid'},expiresAt:new Date(Date.now()+60000)});mocks.member.mockResolvedValue({id:'member'});
 expect(await getCurrentUser()).toBeNull();expect(mocks.member).toHaveBeenCalledWith({where:{principalId:'principal'}});
});
it('preserves unrelated existing accounts even when their email uses the reserved domain',async()=>{
 const user={id:'legacy',email:'legacy@telegram.invalid'};mocks.session.mockResolvedValue({user,expiresAt:new Date(Date.now()+60000)});mocks.member.mockResolvedValue(null);
 expect(await getCurrentUser()).toBe(user);
 mocks.member.mockRejectedValue({code:'P2021'});expect(await getCurrentUser()).toBe(user);
});
