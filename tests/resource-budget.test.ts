import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const disk=vi.hoisted(()=>({free:10*1024**3,used:0}));
vi.mock('node:fs/promises',()=>({default:{statfs:async()=>({bavail:disk.free,bsize:1}),readdir:async()=>[{name:'alice_old.png',isFile:()=>true}],stat:async()=>({size:disk.used})}}));
beforeEach(()=>{vi.resetModules();disk.free=10*1024**3;disk.used=0;});
afterEach(()=>vi.unstubAllEnvs());
async function modules(){
 const budget=await import('../scripts/lib/resource-budget.mjs');
 const runtimePath='../scripts/lib/job-scheduler.mjs';const jobs=await import(runtimePath);
 return {...budget,...jobs};
}
it('does not enforce proposed restrictive quotas without explicit activation',async()=>{
 vi.stubEnv('FW_ENFORCE_DELEGATE_QUOTAS','');const m=await modules();disk.free=512*1024**2;
 await m.runInJob({key:'alice',owner:false},async()=>{for(let i=0;i<6;i++)await m.admitImage();});
});
it('enforces cost-aware per-minute admission when explicitly activated and exempts the owner',async()=>{
 vi.stubEnv('FW_ENFORCE_DELEGATE_QUOTAS','true');const m=await modules();
 await m.runInJob({key:'alice',owner:false},async()=>{await m.admitImage({cost:4});await expect(m.admitImage()).rejects.toThrow('budget');});
 await m.runInJob({key:'owner',owner:true},()=>m.admitImage({cost:1000}));
});
it('rejects insufficient disk and excess personal upload storage without deleting files',async()=>{
 vi.stubEnv('FW_ENFORCE_DELEGATE_QUOTAS','true');const m=await modules();disk.free=1024;
 await expect(m.admitUpload('storage/backgrounds','alice_123',100)).rejects.toThrow('disk');disk.free=10*1024**3;disk.used=250*1024**2;
 await m.runInJob({key:'alice',owner:false},()=>expect(m.admitUpload('storage/backgrounds','alice_123',100)).rejects.toThrow('storage'));
});
it('uses stable private job keys and lets the worker identify delegated deliveries',async()=>{
 const m=await modules();const a=m.renderSecurityHeaders({userId:'alice',owner:false});
 expect(a['x-fw-owner']).toBe('0');expect(a['x-fw-job-key']).toMatch(/^[a-f0-9]{64}$/);expect(a['x-fw-job-key']).not.toContain('alice');
 expect(m.runInJob({key:'alice',owner:false},()=>m.renderSecurityHeaders())).toEqual(a);
});
