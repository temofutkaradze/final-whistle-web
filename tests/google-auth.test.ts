import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {GoogleProfile} from '@/lib/google';
const mocks=vi.hoisted(()=>({db:{authIdentity:{findUnique:vi.fn()},$transaction:vi.fn()}}));
vi.mock('@/lib/db',()=>({prisma:mocks.db}));
import {resolveGoogleUser} from '@/lib/google-auth';

type User={id:string;email:string;passwordHash:string|null;brands?:{name:string}[]};
let users:Map<string,User>,identities:Map<string,string>,emailReads:string[],sequence:number;
const profile=(subject='subject-1',email='owner@example.com'):GoogleProfile=>({subject,email,name:'Owner'});
const uniqueError=()=>Object.assign(new Error('Unique constraint'),{code:'P2002'});
const identityLookup=async(args:{where:{provider_subject:{provider:string;subject:string}}})=>{
 expect(args.where.provider_subject.provider).toBe('google');
 const userId=identities.get(args.where.provider_subject.subject);
 return userId?{userId}:null;
};
beforeEach(()=>{
 vi.resetAllMocks();users=new Map();identities=new Map();emailReads=[];sequence=0;
 mocks.db.authIdentity.findUnique.mockImplementation(identityLookup);
 // Transactional in-memory fake: staged nested writes commit together, with both
 // uniqueness constraints checked at commit. No real database or Google request.
 mocks.db.$transaction.mockImplementation(async callback=>{
  let staged:{user:User;subject:string}|undefined;
  const tx={authIdentity:{findUnique:vi.fn(identityLookup)},user:{
   findUnique:vi.fn(async(args:{where:{email:string}})=>{emailReads.push(args.where.email);const user=users.get(args.where.email);return user?{id:user.id}:null;}),
   create:vi.fn(async(args:{data:{email:string;brands:{create:{name:string}};authIdentities:{create:{provider:string;subject:string}}}})=>{
    expect(args.data.authIdentities.create.provider).toBe('google');
    staged={user:{id:'new-'+(++sequence),email:args.data.email,passwordHash:null,brands:[args.data.brands.create]},subject:args.data.authIdentities.create.subject};return {id:staged.user.id};
   }),
  }};
  const result=await callback(tx);
  if(staged){
   await Promise.resolve();
   if(users.has(staged.user.email)||identities.has(staged.subject)||[...identities.values()].includes(staged.user.id))throw uniqueError();
   users.set(staged.user.email,staged.user);identities.set(staged.subject,staged.user.id);
  }
  return result;
 });
});
describe('Google subject account resolution',()=>{
 it('atomically creates a user, default brand and identity',async()=>{
  const result=await resolveGoogleUser(profile());expect(result).toEqual({ok:true,userId:'new-1'});
  expect(users.get('owner@example.com')?.brands).toEqual([{name:'My page'}]);expect(identities.get('subject-1')).toBe('new-1');
 });
 it('authenticates a bound subject despite changed/colliding email, without modifying accounts',async()=>{
  users.set('old@example.com',{id:'bound',email:'old@example.com',passwordHash:null});
  users.set('owner@example.com',{id:'other',email:'owner@example.com',passwordHash:'existing-hash'});identities.set('subject-1','bound');
  expect(await resolveGoogleUser(profile())).toEqual({ok:true,userId:'bound'});expect(emailReads).toEqual([]);expect(users.size).toBe(2);expect(users.get('owner@example.com')?.passwordHash).toBe('existing-hash');
 });
 it.each(['attacker-password',null])('denies an email-only match, preserving password/legacy data (%s)',async passwordHash=>{
  const user={id:'legacy',email:'owner@example.com',passwordHash};users.set(user.email,user);
  expect(await resolveGoogleUser(profile())).toEqual({ok:false,reason:'account_conflict'});expect(users.get(user.email)).toBe(user);expect(identities.size).toBe(0);
 });
 it('never uses an identity for a different subject with the same verified email',async()=>{
  users.set('owner@example.com',{id:'existing-google',email:'owner@example.com',passwordHash:null});identities.set('other-subject','existing-google');
  expect((await resolveGoogleUser(profile())).ok).toBe(false);expect(identities.size).toBe(1);
 });
 it('rechecks the exact subject when another callback commits between subject and email reads',async()=>{
  const lookup=vi.fn(identityLookup).mockResolvedValueOnce(null);
  const create=vi.fn();
  mocks.db.$transaction.mockImplementationOnce(async callback=>callback({
   authIdentity:{findUnique:lookup},
   user:{findUnique:vi.fn(async()=>{
    // The competing callback commits after the initial subject read and before
    // this email query observes its new user (READ COMMITTED statement snapshots).
    users.set('owner@example.com',{id:'committed-owner',email:'owner@example.com',passwordHash:null});
    identities.set('subject-1','committed-owner');
    return {id:'committed-owner'};
   }),create},
  }));
  expect(await resolveGoogleUser(profile())).toEqual({ok:true,userId:'committed-owner'});
  expect(lookup).toHaveBeenCalledTimes(2);
  for(const [args] of lookup.mock.calls)expect(args).toEqual({where:{provider_subject:{provider:'google',subject:'subject-1'}},select:{userId:true}});
  expect(create).not.toHaveBeenCalled();expect(mocks.db.authIdentity.findUnique).not.toHaveBeenCalled();
  expect(users.size).toBe(1);expect(identities.size).toBe(1);
 });
 it('concurrent callbacks for the same subject return only its one committed binding',async()=>{
  const results=await Promise.all([resolveGoogleUser(profile()),resolveGoogleUser(profile())]);
  expect(results.every(r=>r.ok)).toBe(true);expect(results[0]).toEqual(results[1]);expect(users.size).toBe(1);expect(identities.size).toBe(1);expect([...users.values()][0].brands).toHaveLength(1);
  expect(mocks.db.authIdentity.findUnique).toHaveBeenCalledTimes(1);
 });
 it('rolls back a losing user/brand when the same subject concurrently presents different emails',async()=>{
  const results=await Promise.all([resolveGoogleUser(profile()),resolveGoogleUser(profile('subject-1','changed@example.com'))]);
  expect(results[0]).toEqual(results[1]);expect(results[0].ok).toBe(true);expect(users.size).toBe(1);expect(identities.size).toBe(1);
 });
 it('different subjects racing on one email never share an account',async()=>{
  const results=await Promise.all([resolveGoogleUser(profile()),resolveGoogleUser(profile('subject-2'))]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toHaveLength(1);expect(users.size).toBe(1);expect(identities.size).toBe(1);
 });
 it('a password-signup race is denied without binding or authenticating that account',async()=>{
  mocks.db.$transaction.mockImplementationOnce(async()=>{users.set('owner@example.com',{id:'password-race',email:'owner@example.com',passwordHash:'attacker'});throw uniqueError();});
  expect((await resolveGoogleUser(profile())).ok).toBe(false);expect(identities.size).toBe(0);
  expect(mocks.db.authIdentity.findUnique).toHaveBeenCalledWith({where:{provider_subject:{provider:'google',subject:'subject-1'}},select:{userId:true}});
 });
 it('does not fall back when identity storage is missing or another database error occurs',async()=>{
  for(const code of ['P2021','P2034']){mocks.db.$transaction.mockRejectedValueOnce(Object.assign(new Error('Database unavailable'),{code}));await expect(resolveGoogleUser(profile())).rejects.toMatchObject({code});}
  expect(mocks.db.authIdentity.findUnique).not.toHaveBeenCalled();expect(users.size).toBe(0);
 });
 it('propagates a failed winner lookup rather than recovering by email',async()=>{
  mocks.db.$transaction.mockRejectedValueOnce(uniqueError());mocks.db.authIdentity.findUnique.mockRejectedValueOnce(new Error('Lookup unavailable'));
  await expect(resolveGoogleUser(profile())).rejects.toThrow('Lookup unavailable');expect(emailReads).toEqual([]);
 });
});
