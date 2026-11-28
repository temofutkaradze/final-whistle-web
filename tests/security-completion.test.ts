import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {removeMigrationCredentials,restrictRendererEnvironment} from '../scripts/lib/runtime-environment.cjs';
// @ts-expect-error Standalone trace verifier.
import {sensitiveTraceCategory,inspectSensitiveTraces} from '../scripts/verify-sensitive-traces.mjs';

describe('runtime secret separation',()=>{
 it('removes administrative-only credentials while preserving the runtime connection',()=>{
  const env={DATABASE_URL:'runtime',MIGRATION_DATABASE_URL:'admin',PGPASSWORD:'admin',PGPASSFILE:'private',NEWS_RENDER_SECRET:'renderer'};
  removeMigrationCredentials(env);expect(env).toEqual({DATABASE_URL:'runtime',NEWS_RENDER_SECRET:'renderer'});
 });
 it('keeps renderer inputs but removes database, bot, OAuth and unrelated credentials',()=>{
  const env={PATH:'fixture',TEMP:'fixture',NEWS_RENDER_SECRET:'render-only',RENDER_PORT:'4500',FW_STORAGE_MAINTENANCE_MODE:'apply',FW_ENFORCE_DELEGATE_QUOTAS:'false',DATABASE_URL:'db',MIGRATION_DATABASE_URL:'admin',BOT_TOKEN:'bot',APP_SECRET:'cipher-key',GOOGLE_CLIENT_SECRET:'oauth',UNKNOWN_SECRET:'unknown'};
  restrictRendererEnvironment(env);expect(Object.keys(env).sort()).toEqual(['FW_ENFORCE_DELEGATE_QUOTAS','FW_STORAGE_MAINTENANCE_MODE','NEWS_RENDER_SECRET','PATH','RENDER_PORT','TEMP']);
 });
});
describe('sensitive production traces',()=>{
 it('allows built-in fonts and logos but blocks private paths, credentials and backups',()=>{
  const root=path.resolve('fixture');
  for(const file of ['.env','.env.migration','storage/private-backups/db.dump','render/output/image.png','render/render-server.backup.js','tests/fixtures/photos/photo.jpg','private.pfx'])expect(sensitiveTraceCategory(root,path.join(root,file))).toBeTruthy();
  for(const file of ['render/assets/news/league-symbols/39.png','public/fonts/Anton.woff2','node_modules/next/dist/server.js','.env.example'])expect(sensitiveTraceCategory(root,path.join(root,file))).toBeNull();
  expect(sensitiveTraceCategory(root,path.resolve(root,'../secret'))).toBe('outside-project');
 });
 it('checks manifests and additional roots without returning secret paths or file contents',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'fw-trace-fixture-'));
  try{
   const dir=path.join(root,'.next/server');await mkdir(dir,{recursive:true});
   await mkdir(path.join(root,'render/assets'),{recursive:true});await writeFile(path.join(root,'render/assets/logo.svg'),'<svg/>');
   await writeFile(path.join(dir,'fixture.nft.json'),JSON.stringify({files:['../../render/assets/logo.svg','../../storage/private-backups/never-print.dump','../../.env'],symlinks:[[0,'../../.env']],additionalRoots:[{path:'../..',files:['storage/private.png']}]}));
   const result=await inspectSensitiveTraces(root);expect(result.manifests).toBe(1);expect(result.blockedFiles).toBe(3);expect(JSON.stringify(result)).not.toContain('never-print');
   await writeFile(path.join(dir,'fixture.nft.json'),JSON.stringify({files:['../../render/assets/logo.svg']}));expect((await inspectSensitiveTraces(root)).blockedFiles).toBe(0);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('resolves Turbopack link targets from the manifest base without allowing private or outside targets',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'fw-trace-link-'));
  try{
   const dir=path.join(root,'.next/server/app/api/news/preview');await mkdir(dir,{recursive:true});
   await mkdir(path.join(root,'.next/node_modules'),{recursive:true});
   await writeFile(path.join(root,'.next/node_modules/package-hash'),'fixture');
   await mkdir(path.join(root,'node_modules/package'),{recursive:true});
   const manifest=path.join(dir,'fixture.nft.json');
   const trace=(target:string)=>({files:['../../../../../node_modules/package-hash'],symlinks:[[0,target]]});
   await writeFile(manifest,JSON.stringify(trace('../../../../../../node_modules/package')));
   expect((await inspectSensitiveTraces(root)).blockedFiles).toBe(0);
   await writeFile(manifest,JSON.stringify(trace('../../../../../../.env.migration')));
   expect((await inspectSensitiveTraces(root)).categories).toEqual({environment:1});
   await writeFile(manifest,JSON.stringify(trace('../../../../../../../outside-package')));
   expect((await inspectSensitiveTraces(root)).categories).toEqual({'outside-project':1});
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('both bot loops request the persisted completed offset, including the standalone News loop',async()=>{
  for(const name of ['scripts/lib/poller.mjs','scripts/news-bot.mjs']){
   const source=await readFile(name,'utf8');expect(source).toContain('offset:updateCursor.checkpointOffset');expect(source).toContain('if(updateCursor.pending)await');expect(source).not.toContain('await Promise.all(scheduledWork)');
  }
 });
});
