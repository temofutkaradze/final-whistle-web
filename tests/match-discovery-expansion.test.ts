import {describe,it,expect,vi} from 'vitest';
import {listAvailableMatches} from '../scripts/lib/match-list.mjs';
import {localDayRange} from '../scripts/lib/football.mjs';
vi.mock('../scripts/lib/db.mjs',()=>({prisma:{}}));
import {createFakeDb} from './helpers/fake-prisma';

describe('cold and warm UTC-date discovery',()=>{
 it('discovers an early Tbilisi kickoff after a shutdown with no previous UTC cache',async()=>{
  const kickoff=new Date('2026-12-31T22:30:00Z'); // Jan 1, 02:30 Tbilisi.
  const stored:any[]=[];
  const ensureDay=vi.fn(async(date:string)=>{if(date==='2026-12-31')stored.push({fixtureId:1,kickoff});});
  const prisma={match:{findMany:async()=>stored}};
  const result=await listAvailableMatches({prisma,ensureDay,localDayRange,now:new Date('2027-01-01T00:00:00Z')});
  expect(result.map((m:any)=>m.fixtureId)).toEqual([1]);
 });
 it.each(['2026-11-13','2026-12-01','2027-01-01'])('covers midnight, US evening, and boundaries for %s',date=>{
  const now=new Date(date+'T00:00:00+04:00');
  const range=localDayRange('Asia/Tbilisi',now);
  expect(range.utcDates).toHaveLength(2);
  expect(range.start.toISOString().slice(0,10)).not.toBe(date);
 });
 it.each(['23:59','00:00','00:01','02:30','03:59','04:00','05:00'])('discovers %s Tbilisi on cold and warm caches with unchanged visibility',async time=>{
  const now=new Date('2027-01-01T00:10:00+04:00'),db=createFakeDb({now:now.getTime()}),cached=new Set<string>();let requests=0;
  const kickoff=new Date(`2027-01-01T${time}:00+04:00`);
  const ensureDay=async(date:string)=>{if(cached.has(date))return;cached.add(date);requests++;if(kickoff.toISOString().startsWith(date))db.tables.match.push({fixtureId:1,kickoff});};
  const list=()=>listAvailableMatches({prisma:db.prisma,ensureDay,localDayRange,now});
  expect((await list()).map((m:any)=>m.fixtureId)).toEqual([1]);expect(requests).toBe(2);
  expect((await list()).map((m:any)=>m.fixtureId)).toEqual([1]);expect(requests).toBe(2);
 });
 it('preserves production-equivalent warm midnight behavior and four-hour carryover exactly',async()=>{
  const now=new Date('2027-01-01T00:30:00+04:00'),db=createFakeDb({now:now.getTime()});
  db.tables.match.push({fixtureId:1,kickoff:new Date('2026-12-31T20:30:00+04:00')},{fixtureId:2,kickoff:new Date('2026-12-31T20:29:00+04:00')},{fixtureId:3,kickoff:new Date('2027-01-01T00:00:00+04:00')});
  const cached=new Set(['2026-12-31','2027-01-01']);let requests=0;
  const rows=await listAvailableMatches({prisma:db.prisma,ensureDay:async(d:string)=>{if(!cached.has(d))requests++;},localDayRange,now});
  expect(rows.map((m:any)=>m.fixtureId)).toEqual([1,3]);expect(requests).toBe(0);
 });
});
