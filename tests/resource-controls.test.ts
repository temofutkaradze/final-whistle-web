import {describe,expect,it} from 'vitest';
import {Admission} from '@/lib/admission';
import {LoginLimiter} from '@/lib/password';
import {registerBot,createWithinTemplateQuota} from '@/lib/resource-transactions';
import {createIdleCache,retireCooldowns} from '../scripts/lib/idle-cache.mjs';
const options={perKey:2,windowMs:1000,total:3,totalWindowMs:1000,active:2,activePerKey:1,keys:2};
describe('bounded synchronous admission',()=>{
 it('reserves before await, enforces per-account concurrency, and releases idempotently',()=>{
  const a=new Admission(options,()=>0);const first=a.acquire('one');expect(first).toBeTypeOf('function');expect(a.acquire('one')).toBeNull();const second=a.acquire('two');expect(second).toBeTypeOf('function');expect(a.acquire('three')).toBeNull();first!();first!();expect(a.acquire('one')).toBeTypeOf('function');second!();expect(a.acquire('two')).toBeNull();
 });
 it('fails closed at key capacity and admits again only when old entries expire',()=>{
  let now=0;const a=new Admission({...options,total:10,perKey:10},()=>now);a.acquire('one')!();a.acquire('two')!();expect(a.acquire('three')).toBeNull();now=1001;expect(a.acquire('three')).toBeTypeOf('function');
 });
 it('limits repeated expensive work even after completed requests',()=>{
  const a=new Admission({...options,total:100},()=>0);a.acquire('one')!();a.acquire('one')!();expect(a.acquire('one')).toBeNull();expect(a.acquire('two')).toBeTypeOf('function');
 });
 it('bounds legacy failed-login state without evicting live blocked identities',()=>{
  let now=0;const a=new LoginLimiter(1,1000,()=>now);for(let i=0;i<5000;i++)a.fail(String(i));expect(a.entries.size).toBe(4096);expect(a.allowed('new')).toBe(false);expect(a.allowed('0')).toBe(false);now=1001;expect(a.allowed('new')).toBe(true);expect(a.entries.size).toBe(0);
 });
});
function database(){
 const rows:any={user:[{id:'one',botId:null},{id:'two',botId:null}],newsSettings:[],template:[],newsTemplate:[]};const queries:string[]=[];
 const tx:any={$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{queries.push(strings.join(''));return strings.join('').includes('FOR UPDATE')?rows.user.filter((u:any)=>u.id===values[0]):[{locked:1}];}};
 for(const kind of Object.keys(rows))tx[kind]={findFirst:async({where}:any)=>rows[kind].find((r:any)=>r.botId===where.botId&&(!where.NOT||Object.entries(where.NOT).every(([key,v])=>r[key]!==v))),count:async({where}:any)=>rows[kind].filter((r:any)=>r.userId===where.userId).length};
 let queue=Promise.resolve();const db:any={$transaction:(work:any,options:any)=>{expect(options.isolationLevel).toBe('ReadCommitted');const result=queue.then(async()=>{const before=structuredClone(rows);try{return await work(tx);}catch(e){Object.assign(rows,before);throw e;}});queue=result.then(()=>{},()=>{});return result;}};
 return {rows,queries,db};
}
describe('cross-process database reservation boundaries (mocked PostgreSQL)',()=>{
 it('serializes concurrent Match/News registration of the same bot, including the same account',async()=>{
  const {rows,queries,db}=database();const match=()=>registerBot(db,'one','123','match',async()=>{rows.user[0].botId='123';});const news=()=>registerBot(db,'one','123','news',async()=>{rows.newsSettings.push({userId:'one',botId:'123'});});
  expect(await Promise.all([match(),news()])).toEqual([true,false]);expect(rows.newsSettings).toHaveLength(0);expect(queries.every(q=>q.includes('pg_advisory_xact_lock'))).toBe(true);
 });
 it('allows reconnecting the same generator but refuses another owner or generator',async()=>{
  const {rows,db}=database();rows.newsSettings.push({userId:'one',botId:'123'});
  expect(await registerBot(db,'one','123','news',async()=>{})).toBe(true);expect(await registerBot(db,'two','123','news',async()=>{})).toBe(false);expect(await registerBot(db,'one','123','match',async()=>{})).toBe(false);
 });
 it.each(['match','news'] as const)('enforces the %s quota when two creations race at the last slot',async kind=>{
  const {rows,queries,db}=database();const table=kind==='match'?'template':'newsTemplate';rows[table].push({userId:'one'});
  const create=()=>createWithinTemplateQuota(db,'one',kind,2,async()=>{rows[table].push({userId:'one'});return {id:'new'};});
  const results=await Promise.all([create(),create()]);expect(results.filter(Boolean)).toHaveLength(1);expect(rows[table]).toHaveLength(2);expect(queries.every(q=>q.includes('FOR UPDATE'))).toBe(true);
 });
 it('rolls the whole template operation back when its related settings update fails',async()=>{
  const {rows,db}=database();await expect(createWithinTemplateQuota(db,'one','news',20,async()=>{rows.newsTemplate.push({userId:'one'});throw Error('settings failed');})).rejects.toThrow('settings failed');expect(rows.newsTemplate).toHaveLength(0);
 });
});
describe('disposable cache retirement',()=>{
 it('evicts idle/LRU clients with a hard bound while existing callers keep usable objects',()=>{
  let now=0;const cache=createIdleCache({max:2,ttlMs:100,now:()=>now});const active={token:'fake'};cache.set('one',active);cache.set('two',{});cache.set('three',{});expect(cache.size).toBe(2);expect(cache.get('one')).toBeUndefined();expect(active.token).toBe('fake');now=100;cache.prune();expect(cache.size).toBe(0);
 });
 it('retires only expired/disconnected cooldowns and preserves active cooldowns',()=>{
  const map=new Map([['active',200],['expired',100],['removed',300]]);retireCooldowns(map,new Map([['active',{}],['expired',{}]]),100);expect([...map]).toEqual([['active',200]]);
 });
});
