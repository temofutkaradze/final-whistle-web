import {describe,it,expect,vi} from 'vitest';
// @ts-expect-error Native runtime module.
import {memberAccess,resolveMatchMember,createMemberAdmission} from '../scripts/lib/member-access.mjs';
// @ts-expect-error Native runtime module.
import {createNewsMemberRouter} from '../scripts/lib/news-member-router.mjs';
// @ts-expect-error Native runtime module.
import {createMemberDatabase,guardedTelegram} from '../scripts/lib/member-data.mjs';
import {saveTelegramMember} from '../scripts/lib/member-management.mjs';
import {approvedMatchUser,createMatchAccessHandler,lockMatchAccount} from '../scripts/lib/match-pairing.mjs';

function fixture(){
 const owner={id:'owner',email:'owner@example.test',name:'Owner',botId:'match-bot',botToken:'encrypted-match',telegramChatId:'1'};
 const users=new Map<string,any>([['owner',owner],['alice',{id:'alice',email:'alice@telegram.invalid',botToken:null}],['bob',{id:'bob',email:'bob@telegram.invalid',botToken:null}]]);
 const members=new Map<string,any>(['alice','bob'].map((id,i)=>[id,{id:'member-'+id,ownerId:'owner',principalId:id,telegramUserId:String(i+2),status:'ACTIVE',matchAccess:true,newsAccess:true,version:1}]));
 const settings=new Map<string,any>([['owner',{userId:'owner',botId:'news-bot',botToken:'encrypted-news',telegramChatId:'1',defaultTemplateRef:'single',lastUpdateId:null,pending:null}],...['alice','bob'].map((id,i):[string,any]=>[id,{userId:id,botToken:null,telegramChatId:String(i+2),defaultTemplateRef:'single',pending:null,lastUpdateId:null}])]);
 const matches=(row:any,where:any):boolean=>Object.entries(where).every(([key,value]:[string,any])=>key==='OR'?value.some((w:any)=>matches(row,w)):value&&typeof value==='object'&&'lt'in value?row[key]!=null&&row[key]<value.lt:row[key]===value);
 const db:any={
  $queryRaw:vi.fn(async()=>[{id:'owner'}]),
  user:{findUnique:vi.fn(async({where}:any)=>users.get(where.id)??null),create:vi.fn(async({data}:any)=>({id:'new-principal',...data})),update:vi.fn(async()=>({}))},
  telegramMember:{findUnique:vi.fn(async({where}:any)=>where.principalId?members.get(where.principalId)??null:[...members.values()].find(m=>m.ownerId===where.ownerId_telegramUserId.ownerId&&m.telegramUserId===where.ownerId_telegramUserId.telegramUserId)??null),count:vi.fn(async()=>members.size),create:vi.fn(async({data}:any)=>({id:'new-member',...data})),update:vi.fn(async({where,data}:any)=>{const m=[...members.values()].find(m=>m.id===where.id);Object.assign(m,{...data,version:m.version+1});return m;})},
  newsSettings:{findUnique:vi.fn(async({where}:any)=>structuredClone(settings.get(where.userId)??null)),create:vi.fn(async({data}:any)=>{settings.set(data.userId,{...data,pending:null});return data;}),update:vi.fn(async({where,data}:any)=>Object.assign(settings.get(where.userId),data)),updateMany:vi.fn(async({where,data}:any)=>{const row=settings.get(where.userId);if(!row||!matches(row,where))return {count:0};Object.assign(row,structuredClone(data));return {count:1};})},
  matchTelegramBinding:{findUnique:vi.fn(async({where}:any)=>where.userId==='owner'?{botId:'match-bot',telegramUserId:'1',chatId:'1'}:null)},
  matchDeliveryReceipt:{count:vi.fn(async()=>0),findUnique:vi.fn(async({where}:any)=>where.userId_fixtureId?.userId==='alice'?{userId:'alice',fixtureId:12,finalStatus:'COMPLETED'}:null),deleteMany:vi.fn(async()=>({count:0}))},
  selection:{create:vi.fn(async({data}:any)=>data),updateMany:vi.fn(async()=>({count:1}))},
  brand:{create:vi.fn(async()=>({}))},newsTemplate:{findFirst:vi.fn(async()=>null)},
 };
 db.$transaction=vi.fn(async(work:any)=>work(db));
 return {db,owner,users,members,settings};
}
const identity=(id:string)=>({chatId:id,telegramUserId:id});
const update=(id:number,text?:string,photo?:string)=>({update_id:id,message:{chat:{id:2,type:'private'},from:{id:2,is_bot:false},...(text?{text}:{}),...(photo?{photo:[{file_id:photo,width:800,height:1000}]}:{})}});

describe('shared bot membership authorization',()=>{
 it('preserves the owner binding and resolves delegates to their own principal and recipient',async()=>{
  const f=fixture();expect((await approvedMatchUser(f.db,'owner'))?.id).toBe('owner');
  const guest=await resolveMatchMember(f.db,'owner',identity('2'),{botId:'match-bot',connectionToken:'encrypted-match'});
  expect(guest).toMatchObject({id:'alice',telegramChatId:'2',botId:'match-bot',botToken:'encrypted-match',accessVersion:1});
  expect(f.users.get('alice').botToken).toBeNull();
  expect(await approvedMatchUser(f.db,'alice',{identity:identity('3')})).toBeNull();
  expect(await resolveMatchMember(f.db,'another-owner',identity('2'),{})).toBeNull();
 });
 it('keeps permissions independent and rejects unknown, suspended and revoked users',async()=>{
  const f=fixture(),m=f.members.get('alice');m.matchAccess=false;
  expect(await memberAccess(f.db,m,'match')).toBeNull();expect(await memberAccess(f.db,m,'news')).not.toBeNull();
  for(const status of ['SUSPENDED','REVOKED']){m.status=status;expect(await memberAccess(f.db,m,'news')).toBeNull();}
  expect(await resolveMatchMember(f.db,'owner',identity('99'),{})).toBeNull();
 });
 it('rejects stale permission versions and changed bot credentials',async()=>{
  const f=fixture();expect(await approvedMatchUser(f.db,'alice',{memberVersion:0})).toBeNull();
  expect(await approvedMatchUser(f.db,'alice',{connectionToken:'other-token'})).toBeNull();
 });
 it('scopes Match callbacks to the delegated principal and denies forged/group identities',async()=>{
  const f=fixture(),onAuthorized=vi.fn(),sendMessage=vi.fn(),api=vi.fn();const handler=createMatchAccessHandler({prisma:f.db,onAuthorized});
  const ctx={ownerId:'owner',botId:'match-bot',connectionToken:'encrypted-match',tg:{sendMessage,api}};
  await handler(ctx,update(1,'/matches'));expect(onAuthorized.mock.calls[0][0].actorId).toBe('alice');
  await handler(ctx,{update_id:2,message:{chat:{id:2,type:'private'},from:{id:3},text:'/matches'}});
  await handler(ctx,{update_id:3,message:{chat:{id:2,type:'group'},from:{id:2},text:'/matches'}});expect(onAuthorized).toHaveBeenCalledTimes(1);
  await handler(ctx,{update_id:4,message:{chat:{id:99,type:'private'},from:{id:99},text:'/start'}});expect(sendMessage.mock.calls.at(-1)?.[1]).toContain('Telegram User ID: 99');
 });
 it('bounds per-user rate, global concurrency and key storage',()=>{
  let time=0;const admit=createMemberAdmission(()=>time),a=admit('alice'),b=admit('bob');expect(a).toBeTypeOf('function');expect(b).toBeTypeOf('function');expect(admit('charlie')).toBeNull();expect(admit('alice')).toBeNull();a();b();
  for(let i=1;i<20;i++)admit('alice')();expect(admit('alice')).toBeNull();time=60_001;expect(admit('alice')).toBeTypeOf('function');
 });
 it('rechecks permissions for writes and sends and blocks revoke-restore replay',async()=>{
  const f=fixture(),m={...f.members.get('alice')};
  const {database,check}=createMemberDatabase(f.db,{member:m,generator:'match',scope:{identity:identity('2')},lock:lockMatchAccount});
  await database.selection.create({data:{userId:'alice',fixtureId:12}});expect(f.db.selection.create).toHaveBeenCalledWith({data:{userId:'alice',fixtureId:12}});
  const sendDocument=vi.fn(),tg=guardedTelegram({sendDocument},'2',check);
  await expect(database.selection.create({data:{userId:'bob',fixtureId:12}})).rejects.toThrow('Wrong job owner');
  await expect(tg.sendDocument('1','private.png')).rejects.toThrow('recipient');
  f.members.get('alice').status='REVOKED';await expect(database.selection.create({data:{userId:'alice'}})).rejects.toThrow('revoked');
  f.members.get('alice').status='ACTIVE';f.members.get('alice').version++;
  await expect(tg.sendDocument('2','private.png')).rejects.toThrow('revoked');expect(sendDocument).not.toHaveBeenCalled();
 });
 it('allows a delegate to read only its own Match receipt and never modify receipts',async()=>{
  const f=fixture(),m={...f.members.get('alice')};const {database}=createMemberDatabase(f.db,{member:m,generator:'match',scope:{identity:identity('2')},lock:lockMatchAccount});
  expect(await database.matchDeliveryReceipt.findUnique({where:{userId_fixtureId:{userId:'alice',fixtureId:12}}})).toMatchObject({userId:'alice',fixtureId:12});
  await expect(database.matchDeliveryReceipt.findUnique({where:{userId_fixtureId:{userId:'bob',fixtureId:12}}})).rejects.toThrow('Wrong job owner');
  await expect(database.matchDeliveryReceipt.deleteMany({where:{userId:'alice'}})).rejects.toThrow('read-only');
 });
});

describe('News shared-bot durable state and delivery',()=>{
 function setup(){const f=fixture(),sendMessage=vi.fn(async(..._args:any[])=>({ok:true})),sendDocument=vi.fn(async(..._args:any[])=>({ok:true})),download=vi.fn(async(id:string)=>Buffer.from(id)),render=vi.fn(async(_job:any,bg:Buffer)=>'/mock/news-'+bg.toString()+'.png');const handler=createNewsMemberRouter({prisma:f.db,tg:{sendMessage,sendDocument},ownerId:'owner',connectionToken:'encrypted-news',download,render,cleanup:vi.fn(async()=>{}),isActive:()=>true,onDiagnostic:vi.fn()});return {...f,handler,sendMessage,sendDocument,download,render};}
 it('isolates two simultaneous workflows, headlines, source photos, update claims and PNG recipients',async()=>{
  const f=setup();let cursor=0;
  for(const [text,photo] of [[undefined,'photo'],['Large Headline'],['Automatic'],['PRIVATE HEADLINE'],['No']] as const){await Promise.all([2,3].map(async chat=>{const u=update(++cursor,text?text==='PRIVATE HEADLINE'?'PRIVATE '+chat:text:undefined,photo?photo+chat:undefined);u.message.chat.id=chat;u.message.from.id=chat;await f.handler(u);}));}
  expect(f.sendDocument).toHaveBeenCalledTimes(2);expect(f.sendDocument.mock.calls.map((c:any)=>[c[0],c[1]])).toEqual(expect.arrayContaining([['2','/mock/news-photo2.png'],['3','/mock/news-photo3.png']]));
  expect(f.render.mock.calls.map((c:any)=>c[0].quote)).toEqual(expect.arrayContaining(['PRIVATE 2','PRIVATE 3']));expect(f.settings.get('owner').pending).toBeNull();expect(f.settings.get('alice').pending.stage).toBe('delivered');expect(f.settings.get('bob').pending.stage).toBe('delivered');expect(f.settings.get('owner').lastUpdateId).toBe(cursor);
 });
 it('denies unapproved private users and does not download/render before approval',async()=>{
  const f=setup();f.members.get('alice').newsAccess=false;await f.handler(update(1,'/start'));await f.handler(update(2,undefined,'private-photo'));expect(f.download).not.toHaveBeenCalled();expect(f.render).not.toHaveBeenCalled();expect(f.sendMessage.mock.calls[0][1]).toContain('Telegram User ID: 2');
 });
 it('does not send a rendered private image after revocation during rendering',async()=>{
  const f=setup();f.render.mockImplementationOnce(async()=>{f.members.get('alice').status='REVOKED';return '/mock/private.png';});
  for(const [i,[text,photo]] of [[undefined,'photo'],['Large Headline'],['Automatic'],['PRIVATE'],['No']].entries())await f.handler(update(i+1,text,photo));
  expect(f.render).toHaveBeenCalledTimes(1);expect(f.sendDocument).not.toHaveBeenCalled();
 });
 it('preserves the original owner conversation and delivery recipient',async()=>{
  const f=setup(),u=update(1,'/start');u.message.chat.id=1;u.message.from.id=1;await f.handler(u);expect(f.sendMessage.mock.calls[0][0]).toBe('1');expect(f.sendMessage.mock.calls[0][1]).toContain('Standings');expect(f.members.get('alice').version).toBe(1);
 });
});

describe('owner-only management',()=>{
 const input={telegramUserId:'2',displayName:'Alice',status:'SUSPENDED',matchAccess:false,newsAccess:false};
 it('protects owner identities and refuses accounts without ownership',async()=>{
  const f=fixture();await expect(saveTelegramMember(f.db,'owner',{...input,telegramUserId:'1'})).rejects.toThrow('owner');
  await expect(saveTelegramMember(f.db,'alice',input)).rejects.toThrow('Owner access');expect(f.db.telegramMember.update).not.toHaveBeenCalled();
 });
 it('limits updates to the authenticated owner and retires pending jobs without deleting history',async()=>{
  const f=fixture();await saveTelegramMember(f.db,'owner',input);expect(f.members.get('alice')).toMatchObject({status:'SUSPENDED',version:2});expect(f.db.selection.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'alice',status:{in:['SELECTED','SENDING']}},data:{status:'DESELECTED',liveStatus:'FAILED'}}));expect(f.settings.get('alice').pending).toBeNull();expect(f.db.$queryRaw).toHaveBeenCalled();
 });
 it('creates isolated principals with no passwords, bot tokens or owner selections',async()=>{
  const f=fixture();await saveTelegramMember(f.db,'owner',{...input,telegramUserId:'55',status:'ACTIVE',matchAccess:true});const data=f.db.user.create.mock.calls[0][0].data;expect(data.email).toMatch(/@telegram\.invalid$/);expect(data.botToken).toBeUndefined();expect(data.passwordHash).toBeUndefined();expect(f.db.newsSettings.create).toHaveBeenCalledWith({data:{userId:'new-principal',telegramChatId:'55'}});
 });
});
