import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createFakeDb} from './helpers/fake-prisma';
import {approvedMatchUser,confirmMatchChallenge,createMatchAccessHandler,issueMatchChallenge,privateMatchIdentity,reviewMatchChallenge} from '../scripts/lib/match-pairing.mjs';
let db:ReturnType<typeof createFakeDb>,clock:{now:number};
const scope={ownerId:'owner',botId:'1000',connectionToken:'encrypted-test-connection'};
const identity={telegramUserId:'111',chatId:'111'};
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
beforeEach(()=>{clock={now:Date.UTC(2026,10,6)};db=createFakeDb(clock);db.tables.user.push({id:'owner',botId:'1000',botToken:scope.connectionToken,botUsername:'test_bot',telegramChatId:'777',telegramLinkedAt:new Date(clock.now),pendingBackgroundPath:'old-path'});});
const issue=(person=identity)=>issueMatchChallenge(db.prisma,scope,person,()=>clock.now);
const confirm=(code:string,user='owner')=>confirmMatchChallenge(db.prisma,user,code,()=>clock.now);
describe('private Telegram identity',()=>{
 it('accepts only the actual private sender and rejects groups, forged/missing/bot senders',()=>{
  expect(privateMatchIdentity({chat:{type:'private',id:111},from:{id:111}})).toEqual(identity);
  for(const msg of [{chat:{type:'group',id:-1},from:{id:111}},{chat:{type:'private',id:111},from:{id:222}},{chat:{type:'private',id:111}},{chat:{type:'private',id:111},from:{id:111,is_bot:true}},{chat:{type:'private',id:0},from:{id:0}}])expect(privateMatchIdentity(msg)).toBeNull();
 });
});
describe('website-authorized pairing',()=>{
 it('stores hashes and expiring identity-scoped requests without authorizing first contact',async()=>{
  const result=await issue();expect(result?.code).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(result?.expiresAt.getTime()).toBe(clock.now+600000);
  expect(db.tables.matchPairingChallenge[0]).toMatchObject({userId:'owner',botId:'1000',...identity,codeHash:sha(result!.code),connectionHash:sha(scope.connectionToken)});
  expect(JSON.stringify(db.tables)).not.toContain(result!.code);expect(db.tables.user[0].telegramChatId).toBe('777');expect(await approvedMatchUser(db.prisma,'owner')).toBeNull();
 });
 it('requires the intended authenticated account for review and confirmation',async()=>{
  const request=(await issue())!;db.tables.user.push({id:'other',botId:'2000',botToken:'other'});
  expect(await reviewMatchChallenge(db.prisma,'other',request.code,()=>clock.now)).toBeNull();expect(await confirm(request.code,'other')).toBe(false);expect(db.tables.matchTelegramBinding).toHaveLength(0);
  expect(await reviewMatchChallenge(db.prisma,'owner',request.code,()=>clock.now)).toMatchObject(identity);expect(db.tables.matchPairingChallenge).toHaveLength(1);
 });
 it('consumes once, creates the approved binding and preserves bot/settings/selection data',async()=>{
  db.tables.selection.push({id:'selected',userId:'owner',fixtureId:1});const request=(await issue())!;
  expect(await confirm(request.code)).toBe(true);expect(await confirm(request.code)).toBe(false);
  expect(db.tables.matchTelegramBinding[0]).toMatchObject({userId:'owner',botId:'1000',...identity});expect(db.tables.matchPairingChallenge).toHaveLength(0);
  expect(db.tables.user[0]).toMatchObject({botToken:scope.connectionToken,telegramChatId:'111',pendingBackgroundPath:null});expect(db.tables.selection).toHaveLength(1);
  expect((await approvedMatchUser(db.prisma,'owner'))?.telegramChatId).toBe('111');
 });
 it('rejects expired codes including the exact expiry boundary',async()=>{
  const request=(await issue())!;clock.now=request.expiresAt.getTime();expect(await reviewMatchChallenge(db.prisma,'owner',request.code,()=>clock.now)).toBeNull();expect(await confirm(request.code)).toBe(false);
 });
 it('rejects arbitrary/invalid codes without creating bindings',async()=>{
  for(const code of ['', 'a'.repeat(42),'a'.repeat(43),'../bad'])expect(await confirm(code)).toBe(false);expect(db.tables.matchTelegramBinding).toHaveLength(0);
 });
 it('serializes two concurrent claims for the same code so only one succeeds',async()=>{
  const request=(await issue())!;expect((await Promise.all([confirm(request.code),confirm(request.code)])).sort()).toEqual([false,true]);expect(db.tables.matchTelegramBinding).toHaveLength(1);
 });
 it('never lets two conflicting Telegram identities replace each other',async()=>{
  const a=(await issue())!,b=(await issue({chatId:'222',telegramUserId:'222'}))!;
  expect((await Promise.all([confirm(a.code),confirm(b.code)])).sort()).toEqual([false,true]);expect(db.tables.matchTelegramBinding).toHaveLength(1);expect(db.tables.matchTelegramBinding[0].chatId).toBe('111');
 });
 it('rolls back token consumption and legacy updates if binding creation fails',async()=>{
  const request=(await issue())!;db.failNext('matchTelegramBinding','create',Object.assign(new Error('conflict'),{code:'P2002'}));
  expect(await confirm(request.code)).toBe(false);expect(db.tables.matchPairingChallenge).toHaveLength(1);expect(db.tables.user[0].telegramChatId).toBe('777');expect(await confirm(request.code)).toBe(true);
 });
 it('invalidates pending authorization when bot credentials or bot identity change',async()=>{
  const request=(await issue())!;db.tables.user[0].botToken='changed';expect(await confirm(request.code)).toBe(false);expect(await issue()).toBeNull();
  db.tables.user[0].botToken=scope.connectionToken;db.tables.user[0].botId='different';expect(await confirm(request.code)).toBe(false);
 });
 it('bounds code rotation and pending requests, and invalidates replaced codes',async()=>{
  const first=(await issue())!;expect(await issue()).toBeNull();clock.now+=30000;const next=(await issue())!;expect(next.code).not.toBe(first.code);expect(await confirm(first.code)).toBe(false);
  for(let i=1;i<50;i++)expect(await issue({chatId:String(1000+i),telegramUserId:String(1000+i)})).not.toBeNull();expect(await issue({chatId:'9000',telegramUserId:'9000'})).toBeNull();
 });
 it('rejects corrupted private bindings, stale pollers and legacy links',async()=>{
  expect(await approvedMatchUser(db.prisma,'owner')).toBeNull();const request=(await issue())!;await confirm(request.code);
  expect(await approvedMatchUser(db.prisma,'owner',{connectionToken:'stale'})).toBeNull();expect(await approvedMatchUser(db.prisma,'owner',{identity:{chatId:'222',telegramUserId:'222'}})).toBeNull();
  db.tables.matchTelegramBinding[0].telegramUserId='222';expect(await approvedMatchUser(db.prisma,'owner')).toBeNull();
 });
});
describe('Match message/command/upload/callback security gate',()=>{
 const message=(extra:object={},id=111)=>({message:{chat:{id,type:'private'},from:{id},...extra}});
 const callback=(id=111)=>({callback_query:{id:'callback',from:{id},message:{chat:{id,type:'private'}},data:'select:1'}});
 function gate(){const ctx={...scope,tg:{sendMessage:vi.fn(async()=>{}),api:vi.fn(async()=>{})}},allowed=vi.fn(async()=>{});return {ctx,allowed,handle:createMatchAccessHandler({prisma:db.prisma,onAuthorized:allowed,clock:()=>clock.now})};}
 it('does not authorize first text/upload/callback contact or legacy chat matches',async()=>{
  const f=gate();for(const update of [message({text:'/matches'}),message({photo:[{file_id:'x'}]}),callback(),message({text:'hello'},777)])await f.handle(f.ctx,update);
  expect(f.allowed).not.toHaveBeenCalled();expect(db.tables.matchTelegramBinding).toHaveLength(0);expect(db.tables.user[0].telegramChatId).toBe('777');
 });
 it('issues a private /start code without granting access',async()=>{
  const f=gate();await f.handle(f.ctx,message({text:'/start'}));expect(db.tables.matchPairingChallenge).toHaveLength(1);expect(f.ctx.tg.sendMessage.mock.calls[0]).toBeDefined();expect(f.allowed).not.toHaveBeenCalled();
 });
 it('preserves approved commands, uploads and callbacks but denies other senders/groups',async()=>{
  await confirm((await issue())!.code);const f=gate();for(const update of [message({text:'/matches'}),message({photo:[{file_id:'x'}]}),callback()])await f.handle(f.ctx,update);expect(f.allowed).toHaveBeenCalledTimes(3);
  await f.handle(f.ctx,message({text:'/matches'},222));await f.handle(f.ctx,{message:{chat:{id:-1,type:'group'},from:{id:111},text:'/start'}});expect(f.allowed).toHaveBeenCalledTimes(3);expect(db.tables.matchPairingChallenge).toHaveLength(0);
 });
});
