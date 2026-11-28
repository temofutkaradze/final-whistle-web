import {describe,it,expect,vi} from 'vitest';
import {createFakeDb} from './helpers/fake-prisma';
import {regenerateAssignedMatches} from '../scripts/lib/manual-match-post.mjs';
function setup(){
 const db=createFakeDb({now:100});
 db.tables.user.push({id:'u1',botToken:'test',botId:'1'});
 db.tables.matchTelegramBinding.push({userId:'u1',botId:'1',telegramUserId:'101',chatId:'101'});
 db.tables.brand.push({id:'b',userId:'u1',name:'Page',templateRef:'classic'});
 db.tables.match.push({fixtureId:1,statusShort:'FT',homeTeam:'A',awayTeam:'B',homeScore:2,awayScore:1,eventsJson:[]});
 db.tables.selection.push({id:'s',fixtureId:1,userId:'u1',status:'COMPLETED',backgroundPath:'new.jpg',sentAt:new Date(1),liveStatus:'SENT',finalDispatchAt:new Date(1)});
 const tg={sendDocument:vi.fn(async()=>{})},renderPost=vi.fn(async(_payload:any)=>'/test.jpg'),cleanupMatchArtifacts=vi.fn(async()=>({deleted:0})),cleanupMatchHtml=vi.fn(async()=>({deleted:0}));
 const run=(extra:any={})=>regenerateAssignedMatches({prisma:db.prisma,userId:'u1',backgroundPath:'new.jpg',fixtureId:1,scope:{botId:'1',connectionToken:'test',identity:{chatId:'101',telegramUserId:'101'}},tg,renderPost,cleanupMatchArtifacts,cleanupMatchHtml,brandLookFields:async()=>({page_name:'Page',template:'classic'}),...extra});
 return {db,tg,renderPost,cleanupMatchArtifacts,cleanupMatchHtml,run};
}
describe('manual background regeneration',()=>{
 it('does not dispatch after its manual lease is lost during rendering and always closes the lease',async()=>{
  const f=setup(),release=vi.fn(async()=>{}),lease={acquire:vi.fn(async()=>release),assertHeld:vi.fn(async()=>{throw Object.assign(Error('lost lease'),{deliveryNotAttempted:true});}),close:vi.fn(async()=>{})};
  expect(await f.run({receiptLeaseFactory:async()=>lease})).toMatchObject({sent:0,failed:1});
  expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(f.cleanupMatchArtifacts).not.toHaveBeenCalled();expect(release).toHaveBeenCalledOnce();expect(lease.close).toHaveBeenCalledOnce();
 });
 it('closes the manual lease even if the initial authorization lookup fails',async()=>{
  const f=setup(),lease={acquire:vi.fn(),close:vi.fn(async()=>{})};
  f.db.prisma.user.findUnique=vi.fn(async()=>{throw Error('database offline');});
  await expect(f.run({receiptLeaseFactory:async()=>lease})).rejects.toThrow('database offline');expect(lease.close).toHaveBeenCalledOnce();
 });
 it('repeatedly renders and sends a completed match as a document without altering automatic receipts',async()=>{
  const f=setup(),before=structuredClone(f.db.tables.selection);
  expect(await f.run()).toMatchObject({sent:1});expect(await f.run()).toMatchObject({sent:1});
  expect(f.tg.sendDocument).toHaveBeenCalledTimes(2);expect(f.renderPost.mock.calls[0][0]).toMatchObject({background_path:'new.jpg',home_score:2,away_score:1,page_name:'Page'});
  expect(f.cleanupMatchArtifacts).toHaveBeenCalledTimes(2);
  expect(f.cleanupMatchHtml).toHaveBeenCalledTimes(2);
  expect(f.renderPost.mock.calls[0][0].fixture_id).not.toBe(f.renderPost.mock.calls[1][0].fixture_id);
  expect(f.db.tables.selection).toEqual(before);
 });
 it('does not invent a score or send after authorization is revoked during rendering',async()=>{
  const f=setup();f.db.tables.match[0].homeScore=null;expect(await f.run()).toMatchObject({unavailable:1});expect(f.renderPost).not.toHaveBeenCalled();
  f.db.tables.match[0].homeScore=2;f.renderPost.mockImplementationOnce(async()=>{f.db.tables.matchTelegramBinding.length=0;return '/test.jpg';});
  await f.run();expect(f.tg.sendDocument).not.toHaveBeenCalled();
 });
 it('does not automatically retry an ambiguous Telegram send or modify final status',async()=>{
  const f=setup();f.tg.sendDocument.mockRejectedValueOnce(new Error('timeout'));
  expect(await f.run()).toMatchObject({failed:1});expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.cleanupMatchArtifacts).not.toHaveBeenCalled();expect(f.cleanupMatchHtml).toHaveBeenCalledTimes(1);expect(f.db.tables.selection[0].status).toBe('COMPLETED');
 });
 it('holds a receipt lease around manual render and send, then releases it',async()=>{
  const f=setup(),release=vi.fn(async()=>{}),lease={acquire:vi.fn(async()=>release),close:vi.fn(async()=>{})};
  expect(await f.run({receiptLeaseFactory:vi.fn(async()=>lease)})).toMatchObject({sent:1});
  expect(lease.acquire).toHaveBeenCalledWith(1);expect(release).toHaveBeenCalledOnce();expect(lease.close).toHaveBeenCalledOnce();
 });
 it('does not generate a manual image while receipt cleanup owns the Match lease',async()=>{
  const f=setup(),lease={acquire:vi.fn(async()=>null),close:vi.fn(async()=>{})};
  expect(await f.run({receiptLeaseFactory:vi.fn(async()=>lease)})).toMatchObject({sent:0,failed:1});
  expect(f.renderPost).not.toHaveBeenCalled();expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(lease.close).toHaveBeenCalledOnce();
 });
});
