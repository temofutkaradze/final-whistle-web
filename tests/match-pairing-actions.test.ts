import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({require:vi.fn(),review:vi.fn(),confirm:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireUser:mocks.require}));
vi.mock('@/lib/db',()=>({prisma:{testDatabase:true}}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
vi.mock('../scripts/lib/match-pairing.mjs',()=>({reviewMatchChallenge:mocks.review,confirmMatchChallenge:mocks.confirm}));
import {reviewPairing,confirmPairing} from '@/app/dashboard/match/pairing-actions';
beforeEach(()=>{vi.resetAllMocks();mocks.require.mockResolvedValue({id:'session-owner'});});
afterEach(()=>vi.restoreAllMocks());
const form=()=>{const data=new FormData();data.set('code','a'.repeat(43));data.set('userId','attacker');return data;};
describe('authenticated Match pairing actions',()=>{
 it('requires a website session before reviewing or consuming any code',async()=>{
  mocks.require.mockRejectedValue(new Error('Not authenticated'));await expect(reviewPairing({},form())).rejects.toThrow('Not authenticated');await expect(confirmPairing({},form())).rejects.toThrow('Not authenticated');expect(mocks.review).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('reviews only for the session owner, never a submitted account ID',async()=>{
  mocks.review.mockResolvedValue({telegramUserId:'111',chatId:'111',botUsername:'bot',expiresAt:'later'});
  expect(await reviewPairing({},form())).toMatchObject({review:{telegramUserId:'111'}});expect(mocks.review.mock.calls[0][1]).toBe('session-owner');expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('requires explicit confirmation and ignores forged review state/account IDs',async()=>{
  expect(await confirmPairing({review:{code:'forged',telegramUserId:'999',chatId:'999',botUsername:'fake',expiresAt:'later'}},form())).toHaveProperty('error');expect(mocks.confirm).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true);const data=form();data.set('confirm','yes');expect(await confirmPairing({},data)).toHaveProperty('success');expect(mocks.confirm.mock.calls[0].slice(1)).toEqual(['session-owner','a'.repeat(43)]);expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard/match');
 });
 it('does not report approval or revalidate a rejected/replayed/expired confirmation',async()=>{
  mocks.confirm.mockResolvedValue(false);const data=form();data.set('confirm','yes');expect(await confirmPairing({},data)).toHaveProperty('error');expect(mocks.revalidate).not.toHaveBeenCalled();
 });
});
