import {describe,expect,it,vi} from 'vitest';
// @ts-expect-error Runtime-only queue primitive.
import {createOrderedUpdateCursor} from '../scripts/lib/ordered-update-cursor.mjs';

describe('Telegram cursor follows scheduled processing',()=>{
 it('does not persist the poll offset before a work item is completed',async()=>{
  const persist=vi.fn(async()=>{}),cursor=createOrderedUpdateCursor(40,persist),ticket=cursor.accept(40);
  expect(cursor.fetchOffset).toBe(41);expect(cursor.checkpointOffset).toBe(40);expect(persist).not.toHaveBeenCalled();
  await ticket.complete();expect(cursor.checkpointOffset).toBe(41);expect(persist).toHaveBeenCalledExactlyOnceWith(41);
 });
 it('commits only the completed prefix, in Telegram update order',async()=>{
  const persisted:number[]=[],cursor=createOrderedUpdateCursor(10,async (n:number)=>{persisted.push(n);});
  const a=cursor.accept(10),b=cursor.accept(11);await b.complete();expect(persisted).toEqual([]);
  await a.complete();expect(persisted).toEqual([11,12]);
 });
 it('leaves an interrupted uncompleted update replayable from the durable cursor',()=>{
  const persisted=10,cursor=createOrderedUpdateCursor(persisted,async()=>{}),ticket=cursor.accept(10);
  expect(cursor.fetchOffset).toBe(11);expect(cursor.pending).toBe(1);
  const restarted=createOrderedUpdateCursor(persisted,async()=>{});
  expect(restarted.fetchOffset).toBe(10);expect(restarted.accept(10)).not.toBeNull();expect(ticket).toBeDefined();
 });
 it('retries a failed prefix checkpoint without re-running the completed job',async()=>{
  let fail=true,runs=0;const cursor=createOrderedUpdateCursor(1,async()=>{if(fail)throw Error('temporary disk error');});
  const ticket=cursor.accept(1);runs++;
  await expect(ticket.complete()).rejects.toThrow('temporary');expect(runs).toBe(1);expect(cursor.checkpointOffset).toBe(1);
  fail=false;await cursor.retry();expect(runs).toBe(1);expect(cursor.pending).toBe(0);expect(cursor.checkpointOffset).toBe(2);
 });
});
