import path from 'node:path';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {assignPendingBackground,deleteUnusedBackground,withBackgroundFile} from '../scripts/lib/background-files.mjs';
import {createFakeDb} from './helpers/fake-prisma';
const ROOT=path.resolve('storage/backgrounds');const file=path.join(ROOT,'shared.jpg');
let db:ReturnType<typeof createFakeDb>;
const io=()=>({realpath:vi.fn(async(p:string)=>p),lstat:vi.fn(async()=>({isFile:():boolean=>true,isSymbolicLink:():boolean=>false})),unlink:vi.fn(async()=>{})});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{db=createFakeDb({now:0});db.tables.user.push({id:'u1',pendingBackgroundPath:file});db.tables.selection.push({id:'one',userId:'u1',fixtureId:1,status:'SELECTED'},{id:'two',userId:'u1',fixtureId:2,status:'SELECTED'},{id:'other',userId:'u2',fixtureId:3,status:'SELECTED'},{id:'claimed',userId:'u1',fixtureId:4,status:'SENDING'});});
describe('background reference coordination (all filesystem operations mocked)',()=>{
 it('preserves assign-to-all, ownership, SELECTED filtering and single pending consumption',async()=>{
  const query=vi.spyOn(db.prisma,'$queryRaw');expect(await assignPendingBackground(db.prisma,'u1',file,'all')).toEqual({count:2});
  expect(db.tables.selection.filter(s=>s.backgroundPath===file).map(s=>s.id)).toEqual(['one','two']);
  expect(await assignPendingBackground(db.prisma,'u1',file,'all')).toEqual({count:0});expect(query).toHaveBeenCalled();expect(Array.from(query.mock.calls[0][0] as TemplateStringsArray).join('')).toContain('pg_advisory_xact_lock');expect(typeof query.mock.calls[0][1]).toBe('bigint');
 });
 it('assigns one chosen fixture and does not consume another upload through a stale callback',async()=>{
  expect(await assignPendingBackground(db.prisma,'u1',file,2)).toEqual({count:1});expect(db.tables.selection[0].backgroundPath).toBeUndefined();
  db.tables.user[0].pendingBackgroundPath=path.join(ROOT,'new.jpg');expect(await assignPendingBackground(db.prisma,'u1',file,'all')).toEqual({count:0});expect(db.tables.user[0].pendingBackgroundPath).toContain('new.jpg');
 });
 it.each(['selection','user','brand'])('protects normalized retained %s references',async model=>{
  db.tables.user[0].pendingBackgroundPath=null;const alias=path.join(ROOT,'unused','..','shared.jpg');
  if(model==='user')db.tables.user[0].pendingBackgroundPath=alias;
  else db.tables[model].push({id:'reference',backgroundPath:alias});
  const fs=io();expect(await deleteUnusedBackground(db.prisma,file,fs)).toBe(false);expect(fs.unlink).not.toHaveBeenCalled();
 });
 it.each([path.resolve('storage/backgrounds/../../outside.txt'),ROOT,path.join(ROOT,'nested','image.jpg'),path.join(ROOT,'image.jpg:stream'),path.join(ROOT,'shared.jpg.'),path.join(ROOT,'shared.jpg '),path.join(ROOT,'SHARED~1.JPG'),path.join(ROOT,'NUL.jpg')])('refuses unsafe cleanup path %s before filesystem access',async unsafe=>{
  const fs=io();expect(await deleteUnusedBackground(db.prisma,unsafe,fs)).toBe(false);expect(fs.realpath).not.toHaveBeenCalled();expect(fs.unlink).not.toHaveBeenCalled();
 });
 it('rejects a symlink or a real path escaping the permitted directory',async()=>{
  db.tables.user[0].pendingBackgroundPath=null;const fs=io();fs.realpath.mockImplementation(async p=>p===file?path.resolve('outside.jpg'):p);
  expect(await deleteUnusedBackground(db.prisma,file,fs)).toBe(false);fs.realpath.mockImplementation(async p=>p);fs.lstat.mockResolvedValue({isFile:()=>false,isSymbolicLink:()=>true});expect(await deleteUnusedBackground(db.prisma,file,fs)).toBe(false);expect(fs.unlink).not.toHaveBeenCalled();
 });
 it('keeps a reference committed before cleanup acquires the file lock',async()=>{
  const ready=deferred(),release=deferred();const fs=io();
  const assigning=withBackgroundFile(db.prisma,file,async tx=>{ready.resolve();await release.promise;await tx.selection.updateMany({where:{id:'one'},data:{backgroundPath:file}});await tx.user.updateMany({where:{id:'u1'},data:{pendingBackgroundPath:null}});});
  await ready.promise;const cleaning=deleteUnusedBackground(db.prisma,file,fs);release.resolve();await assigning;expect(await cleaning).toBe(false);expect(fs.unlink).not.toHaveBeenCalled();
 });
 it('does not recreate a deleted file reference from a stale callback waiting behind cleanup',async()=>{
  db.tables.user[0].pendingBackgroundPath=null;const ready=deferred(),release=deferred();const fs=io();fs.unlink.mockImplementation(async()=>{ready.resolve();await release.promise;});
  const cleaning=deleteUnusedBackground(db.prisma,file,fs);await ready.promise;const assigning=assignPendingBackground(db.prisma,'u1',file,'all');release.resolve();expect(await cleaning).toBe(true);expect(await assigning).toEqual({count:0});expect(db.tables.selection.every(s=>!s.backgroundPath)).toBe(true);
 });
 it('allows only one of two concurrent assignment callbacks to consume the upload',async()=>{
  const results=await Promise.all([assignPendingBackground(db.prisma,'u1',file,'all'),assignPendingBackground(db.prisma,'u1',file,'all')]);expect(results.map(r=>r.count)).toEqual([2,0]);
 });
 it('rolls pending consumption back if assigning the selections fails',async()=>{
  db.failNext('selection','updateMany',new Error('database unavailable'));await expect(assignPendingBackground(db.prisma,'u1',file,'all')).rejects.toThrow('database unavailable');expect(db.tables.user[0].pendingBackgroundPath).toBe(file);
 });
});
