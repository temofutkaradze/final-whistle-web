import {afterEach,describe,expect,it,vi} from 'vitest';
import logging from '../scripts/lib/security-log.cjs';
import {verifiedDatabaseUrl} from '../scripts/lib/database-tls.mjs';
import {contentSecurityPolicy} from '@/lib/security-policy';
import {registrationAllowed} from '@/lib/local-security';
// @ts-expect-error Native bot runtime module.
import {createJobScheduler,createReplyBudget} from '../scripts/lib/job-scheduler.mjs';
// @ts-expect-error Native bot runtime module.
import {createMemberDatabase} from '../scripts/lib/member-data.mjs';

afterEach(()=>vi.unstubAllEnvs());
it('redacts actual configured secrets, embedded credentials, tokens and error stacks',()=>{
 vi.stubEnv('APP_SECRET','test-private-key-do-not-print');
 const token='123456789:'+ 'x'.repeat(35);logging.registerSecret(token);
 const result=logging.redact(`APP_SECRET=test-private-key-do-not-print https://api.telegram.org/bot${token}/sendDocument postgresql://alice:private-password@host/db v1:${'A'.repeat(40)}`);
 expect(result).not.toContain('test-private');expect(result).not.toContain(token);expect(result).not.toContain('private-password');expect(result).not.toContain('A'.repeat(40));
});
it('pins verified remote PostgreSQL TLS without changing local fixture connections',()=>{
 expect(new URL(verifiedDatabaseUrl('postgresql://u:p@db.neon.tech/db?sslmode=require&uselibpqcompat=true')).searchParams.get('sslmode')).toBe('verify-full');
 expect(new URL(verifiedDatabaseUrl('postgresql://u:p@127.0.0.1/db?sslmode=disable')).searchParams.get('sslmode')).toBe('disable');
 vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED','0');expect(()=>verifiedDatabaseUrl('postgresql://u:p@db.neon.tech/db')).toThrow('verification');
});
it('uses nonce script CSP, disables inline handlers and permits existing inline styles',()=>{
 const csp=contentSecurityPolicy('a'.repeat(24));expect(csp).toContain("'nonce-"+'a'.repeat(24));
 expect(csp.split(';')[1]).not.toContain('unsafe-inline');expect(csp).not.toContain('unsafe-eval');expect(csp).toContain("script-src-attr 'none'");
 expect(csp).toContain("style-src 'self' 'unsafe-inline'");expect(()=>contentSecurityPolicy("'bad")).toThrow();
});
it('denies public registration by default and requires explicit opt-in',()=>{
 vi.stubEnv('FW_ALLOW_REGISTRATION','');expect(registrationAllowed()).toBe(false);vi.stubEnv('FW_ALLOW_REGISTRATION','true');expect(registrationAllowed()).toBe(true);
});
describe('bounded owner-priority scheduling',()=>{
 it('runs owner commands while a delegated render is blocked and retains conversation order',async()=>{
  const jobs=createJobScheduler(),seen:string[]=[];let release!:()=>void;const blocked=new Promise<void>(r=>release=r);
  const a=jobs.enqueue('alice',false,async()=>{seen.push('alice-1');await blocked;});
  const b=jobs.enqueue('alice',false,async()=>seen.push('alice-2'));
  const c=jobs.enqueue('bob',false,async()=>seen.push('bob'));
  const owner=jobs.enqueue('owner',true,async()=>seen.push('owner'));
  await owner;expect(seen).toEqual(['alice-1','owner']);release();await Promise.all([a,b,c]);await jobs.idle();
  expect(seen.indexOf('alice-2')).toBeGreaterThan(seen.indexOf('alice-1'));expect(seen).toContain('bob');
 });
 it('bounds queue growth and rejects work after drain without dropping accepted jobs',async()=>{
  const jobs=createJobScheduler({maxQueued:2,perUserQueued:1});let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const a=jobs.enqueue('alice',false,()=>gate);const b=jobs.enqueue('alice',false,async()=>{});
  expect(jobs.enqueue('alice',false,async()=>{})).toBeNull();const close=jobs.close();expect(jobs.enqueue('owner',true,async()=>{})).toBeNull();release();await Promise.all([a,b,close]);
 });
 it('reserves admission for the owner even when delegated queues are saturated',async()=>{
  const jobs=createJobScheduler({maxQueued:4,perUserQueued:4});let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const work=[jobs.enqueue('alice',false,()=>gate)];
  for(const key of ['bob','carol','dave'])work.push(jobs.enqueue(key,false,async()=>{}));
  expect(jobs.enqueue('eve',false,async()=>{})).toBeNull();
  const owner=jobs.enqueue('owner',true,async()=>'owner');expect(owner).not.toBeNull();expect(await owner).toBe('owner');release();await Promise.all(work);await jobs.close();
 });
 it('throttles repeated unauthorized replies without retaining unbounded identities',()=>{
  let time=0;const allow=createReplyBudget(()=>time);expect(allow('1')).toBe(true);expect(allow('1')).toBe(false);for(let i=2;i<=10;i++)expect(allow(String(i))).toBe(true);expect(allow('11')).toBe(false);time=60_001;expect(allow('1')).toBe(true);
 });
});
it('scopes private reads and transactions and rejects raw SQL and relation escapes',async()=>{
 const member={principalId:'alice',ownerId:'owner',telegramUserId:'2',version:1,status:'ACTIVE',newsAccess:true};
 const reads:any[]=[];
 const db:any={match:{findMany:vi.fn()},telegramMember:{findUnique:async()=>member},newsSettings:{findUnique:async()=>({botId:'news',botToken:'cipher'})},selection:{findMany:async(args:any)=>{reads.push(args);return [];}},user:{findUnique:async()=>({id:'alice'})}};
 db.$transaction=async(fn:any)=>fn(db);
 const {database}=createMemberDatabase(db,{member,generator:'news',scope:{},lock:async()=>true});
 await database.selection.findMany({where:{status:'SELECTED'}});expect(reads[0].where.userId).toBe('alice');
 await expect(database.selection.findMany({where:{userId:'bob'}})).rejects.toThrow('owner');
 await expect(database.selection.findMany({include:{user:true}})).rejects.toThrow('private');
 await expect(database.match.findMany({select:{selections:true}})).rejects.toThrow('private');
 expect(()=>database.$queryRawUnsafe).toThrow('capability');
 await database.$transaction(async(tx:any)=>{expect(()=>tx.$executeRaw).toThrow('capability');await expect(tx.user.findUnique({where:{id:'owner'}})).rejects.toThrow('owner');});
});
