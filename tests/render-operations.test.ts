import {afterEach,describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const {createSingleFlight,createMetrics,withPageDeadline,createCapturePolicy,createDrainTracker}=createRequire(import.meta.url)('../render/operations.js');
afterEach(()=>{vi.useRealTimers();});
function deferred(){let resolve!:(value?:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
describe('bounded renderer operations',()=>{
 it('shares only concurrent identical work and clears settled entries',async()=>{
  const gate=deferred(),work=vi.fn(()=>gate.promise),flight=createSingleFlight(2);
  const a=flight.run('same',work),b=flight.run('same',work);expect(a).toBe(b);await Promise.resolve();expect(work).toHaveBeenCalledTimes(1);gate.resolve('ok');expect(await a).toBe('ok');expect(flight.size).toBe(0);
  expect(await flight.run('same',()=>123)).toBe(123);
 });
 it('removes rejected work so the next request retries safely',async()=>{
  const flight=createSingleFlight();await expect(flight.run('x',()=>{throw Error('network');})).rejects.toThrow('network');expect(flight.size).toBe(0);expect(await flight.run('x',()=>7)).toBe(7);
 });
 it('never grows its tracked map beyond the cap or queues excess keys',async()=>{
  expect(()=>createSingleFlight(Infinity)).toThrow();const held=deferred(),flight=createSingleFlight(1),a=flight.run('a',()=>held.promise);expect(await flight.run('b',()=>2)).toBe(2);expect(flight.size).toBe(1);held.resolve();await a;expect(flight.size).toBe(0);
 });
 it('keeps a fixed latency window per route and separates failures/rejections/cancellations',()=>{
  const stats=createMetrics(3);for(const n of [10,20,30,40])stats.record('match',200,n);stats.record('match',401,50);stats.record('match',503,50);stats.record('match',500,50);stats.record('news',200,15);stats.record('news',200,5,true);
  expect(stats.snapshot().routes.match).toEqual({succeeded:4,rejected:2,failed:1,cancelled:0,samples:3,p50_ms:30,p95_ms:40});expect(stats.snapshot().routes.news).toMatchObject({succeeded:1,cancelled:1,samples:1,p50_ms:15});expect(()=>createMetrics(1000)).toThrow();
 });
 it('does not retain mutable latency samples in snapshots',()=>{
  const stats=createMetrics();for(let i=0;i<250;i++)stats.record('news',200,i);const result=stats.snapshot();expect(result.routes.news.samples).toBe(200);result.routes.news.samples=0;expect(stats.snapshot().routes.news.samples).toBe(200);expect(result.routes.match.p50_ms).toBeNull();
 });
 it('closes only the expired page and clears the deadline timer',async()=>{
  vi.useFakeTimers();const page={close:vi.fn(async()=>{})},sibling={close:vi.fn()};const pending=withPageDeadline(page,()=>new Promise(()=>{}),50);const rejected=expect(pending).rejects.toMatchObject({code:'RENDER_PAGE_DEADLINE'});await vi.advanceTimersByTimeAsync(50);await rejected;expect(page.close).toHaveBeenCalledTimes(1);expect(sibling.close).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('clears timers on success or ordinary failure without closing pages',async()=>{
  vi.useFakeTimers();const page={close:vi.fn()};expect(await withPageDeadline(page,()=>42,10)).toBe(42);await expect(withPageDeadline(page,()=>{throw Error('bad page');},10)).rejects.toThrow('bad page');expect(vi.getTimerCount()).toBe(0);expect(page.close).not.toHaveBeenCalled();
 });
 it('allows sibling work and consumes late rejection from a timed-out page',async()=>{
  vi.useFakeTimers();let reject!:(e:Error)=>void;const page={close:vi.fn(async()=>{reject(Error('page closed'));})};const pending=withPageDeadline(page,()=>new Promise((_r,j)=>{reject=j;}),5);const result=expect(pending).rejects.toThrow('deadline');expect(await withPageDeadline({close:vi.fn()},()=>3,50)).toBe(3);await vi.advanceTimersByTimeAsync(5);await result;expect(vi.getTimerCount()).toBe(0);
 });
 it('requires three consecutive qualifying capture failures and resets after success',()=>{
  const policy=createCapturePolicy();policy.failure(Error('unsupported'));policy.failure(Error('unsupported'));expect(policy.enabled).toBe(true);policy.success();policy.failure();policy.failure();expect(policy.enabled).toBe(true);expect(policy.failure()).toBe(true);expect(policy.enabled).toBe(false);policy.success();expect(policy.enabled).toBe(false);
 });
 it('does not let closed pages, browser crashes or timeouts poison capture capability',()=>{
  const policy=createCapturePolicy();for(const message of ['Target closed','Browser disconnected','page crashed','fast screenshot timed out','timeout','Render page deadline exceeded'])policy.failure(Error(message));expect(policy.enabled).toBe(true);policy.failure();policy.failure();expect(policy.enabled).toBe(true);
 });
 it('drains admitted work including queued jobs, refuses new work and is idempotent',async()=>{
  const tracker=createDrainTracker(),match=tracker.begin(),news=tracker.begin();const idle=tracker.drain();expect(tracker.drain()).toBe(idle);expect(tracker.begin()).toBeNull();let finished=false;idle.then(()=>{finished=true;});match();match();await Promise.resolve();expect(finished).toBe(false);expect(tracker.active).toBe(1);news();await idle;expect(finished).toBe(true);expect(tracker.active).toBe(0);await tracker.drain();
 });
});
