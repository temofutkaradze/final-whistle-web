import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),save:vi.fn(),owner:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({prisma:{telegramMember:{findMany:vi.fn(async()=>[])}}}));
vi.mock('../scripts/lib/member-management.mjs',()=>({saveTelegramMember:mocks.save,managedOwner:mocks.owner}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Object.assign(new Error('Redirect'),{path});}}));
import {saveAccess} from '@/app/dashboard/users/actions';
import UserManagement from '@/app/dashboard/users/page';
beforeEach(()=>{vi.resetAllMocks();});
describe('User Management authenticated boundary',()=>{
 it('requires a website session before calling management or reading member records',async()=>{
  mocks.requireUser.mockRejectedValue(new Error('Unauthenticated'));
  await expect(saveAccess(new FormData())).rejects.toThrow('Unauthenticated');
  await expect(UserManagement({searchParams:Promise.resolve({})})).rejects.toThrow('Unauthenticated');
  expect(mocks.save).not.toHaveBeenCalled();expect(mocks.owner).not.toHaveBeenCalled();
 });
 it('ignores forged owner identifiers and takes the owner exclusively from the session',async()=>{
  mocks.requireUser.mockResolvedValue({id:'signed-in-owner'});mocks.save.mockResolvedValue({id:'member'});
  const data=new FormData();data.set('ownerId','victim');data.set('telegramUserId','22');data.set('status','ACTIVE');data.set('matchAccess','on');
  await expect(saveAccess(data)).rejects.toMatchObject({path:'/dashboard/users?saved=1'});
  expect(mocks.save.mock.calls[0][1]).toBe('signed-in-owner');expect(mocks.save.mock.calls[0][2]).toMatchObject({telegramUserId:'22',matchAccess:true,newsAccess:false});
 });
 it('redirects non-owner accounts before exposing User Management',async()=>{
  mocks.requireUser.mockResolvedValue({id:'ordinary-user'});mocks.owner.mockRejectedValue(new Error('Owner access required'));
  await expect(UserManagement({searchParams:Promise.resolve({})})).rejects.toMatchObject({path:'/dashboard'});
 });
 it('does not disclose database errors or secret values in form responses',async()=>{
  mocks.requireUser.mockResolvedValue({id:'owner'});mocks.save.mockRejectedValue(new Error('private database details'));
  await expect(saveAccess(new FormData())).rejects.toMatchObject({path:'/dashboard/users?error=1'});
 });
});
