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
 const tg={sendDocument:vi.fn(async()=>{})},renderPost=vi.fn(async(_payload:any)=>'/test.jpg');
 const run=()=>regenerateAssignedMatches({prisma:db.prisma,userId:'u1',backgroundPath:'new.jpg',fixtureId:1,scope:{botId:'1',connectionToken:'test',identity:{chatId:'101',telegramUserId:'101'}},tg,renderPost,brandLookFields:async()=>({page_name:'Page',template:'classic'})});
 return {db,tg,renderPost,run};
}
describe('manual background regeneration',()=>{
 it('repeatedly renders and sends a completed match as a document without altering automatic receipts',async()=>{
  const f=setup(),before=structuredClone(f.db.tables.selection);
  expect(await f.run()).toMatchObject({sent:1});expect(await f.run()).toMatchObject({sent:1});
  expect(f.tg.sendDocument).toHaveBeenCalledTimes(2);expect(f.renderPost.mock.calls[0][0]).toMatchObject({background_path:'new.jpg',home_score:2,away_score:1,page_name:'Page'});
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
  expect(await f.run()).toMatchObject({failed:1});expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.db.tables.selection[0].status).toBe('COMPLETED');
 });
});
