import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
// @ts-expect-error Runtime module is tested directly without a declaration shim.
import {acquireProcessLock,PROCESS_LOCKS,lockConnectionString} from '../scripts/lib/process-lock.mjs';
class Client extends EventEmitter{
 owned=true;backend=100;ended=false;query=vi.fn(async(sql:string)=>({rows:[{locked:this.owned,backend_pid:this.backend}]}));
 async connect(){}async end(){this.ended=true;this.emit('end');}
}
afterEach(()=>vi.useRealTimers());
describe('dedicated process locks',()=>{
 it('uses a distinct lock for each role and retains the original News key',()=>{expect(new Set(Object.values(PROCESS_LOCKS)).size).toBe(3);expect(PROCESS_LOCKS.news).toBe(1313167187);});
 it('derives the direct Neon hostname without changing auth, database or options',()=>{const value=lockConnectionString('postgresql://test:unused@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require');const url=new URL(value);expect(url.hostname).toBe('ep-example.eu-central-1.aws.neon.tech');expect(url.username).toBe('test');expect(url.password).toBe('unused');expect(url.pathname).toBe('/neondb');expect(url.searchParams.get('sslmode')).toBe('require');});
 it('does not rewrite a non-Neon hostname',()=>{expect(new URL(lockConnectionString('postgresql://test:unused@database.example.com/test')).hostname).toBe('database.example.com');});
 it('refuses a second owner without invoking its work',async()=>{const client=new Client();client.owned=false;expect(await acquireProcessLock(client,{key:1})).toBeNull();expect(client.ended).toBe(true);});
 it('verifies actual session lock ownership on heartbeat',async()=>{const client=new Client(),lost=vi.fn();const lock=await acquireProcessLock(client,{key:1,onLost:lost});await lock.heartbeat();expect(client.query.mock.calls[1][0]).toContain('pg_locks');client.owned=false;await expect(lock.heartbeat()).rejects.toMatchObject({code:'PROCESS_LOCK_LOST'});expect(lock.active()).toBe(false);expect(lost).toHaveBeenCalledWith(expect.objectContaining({reason:'session_lock_missing'}));await lock.release();});
 it('fails closed if a pool or proxy changes backend sessions',async()=>{const client=new Client(),lost=vi.fn();const lock=await acquireProcessLock(client,{key:1,onLost:lost});client.backend=200;await expect(lock.heartbeat()).rejects.toThrow('PROCESS_LOCK_LOST');expect(lock.active()).toBe(false);await lock.release();});
 it('checks in the background even while a worker is waiting on a render',async()=>{vi.useFakeTimers();const client=new Client(),lost=vi.fn();const lock=await acquireProcessLock(client,{key:1,onLost:lost,heartbeatMs:1000});client.query.mockRejectedValueOnce(Object.assign(new Error('secret details must not leak'),{code:'ECONNRESET'}));await vi.advanceTimersByTimeAsync(1000);expect(lock.active()).toBe(false);expect(lost).toHaveBeenCalledWith({reason:'heartbeat_failed',databaseCode:null,networkCode:'ECONNRESET'});await lock.release();});
 it('reports connection loss without including raw errors or reconnecting',async()=>{const client=new Client(),lost=vi.fn();const lock=await acquireProcessLock(client,{key:1,onLost:lost});client.emit('error',Object.assign(new Error('private connection text'),{code:'08006'}));expect(lock.active()).toBe(false);expect(lost).toHaveBeenCalledExactlyOnceWith({reason:'connection_error',databaseCode:'08006',networkCode:null});expect(client.query).toHaveBeenCalledTimes(1);await lock.release();});
});
