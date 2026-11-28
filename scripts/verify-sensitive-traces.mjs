import {readdir,readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function sensitiveTraceCategory(root,file){
 const rel=path.relative(root,file).replaceAll('\\','/').toLowerCase();
 if(rel==='..'||rel.startsWith('../')||path.isAbsolute(rel))return 'outside-project';
 if(/(^|\/)\.env(?:$|\.)/.test(rel)&&!rel.endsWith('/.env.example')&&rel!=='.env.example')return 'environment';
 if(/\.(?:pfx|p12|key|pem|dump|bak|7z|zip|log)$/.test(rel)&&!rel.startsWith('node_modules/'))return 'secrets-backups-logs';
 if(/^(?:storage|preview-images|docs\/previews|tests\/fixtures\/photos)\//.test(rel))return 'private-storage';
 if(/^render\/(?:output|rendered|cache)\//.test(rel)||/(?:^|\/)[^/]*(?:\.backup\.|\.backup$)/.test(rel))return 'temporary-backup';
 return null;
}

export async function inspectSensitiveTraces(root){
 const build=path.join(root,'.next'),counts={},seen=new Set(),checked=new Set();let manifests=0;
 async function inspectFile(base,relative){
  if(typeof relative!=='string')throw Error('Malformed trace entry');
  const full=path.resolve(base,relative);
  if(checked.has(full))return;checked.add(full);
  let category=sensitiveTraceCategory(root,full);
  // Catch links to private files even if the trace gives an apparently safe name.
  if(!category){try{category=sensitiveTraceCategory(root,await realpath(full));}catch{category='missing-traced-file';}}
  if(category&&!seen.has(full)){seen.add(full);counts[category]=(counts[category]??0)+1;}
 }
 async function inspectLinks(base,files,links){
  // Turbopack targets are relative to the manifest/root base, NOT the link's
  // parent directory (see installed next/dist/build/nft.js mapNftFileEntries).
  for(const [index,target]of (Array.isArray(links)?links:Object.entries(links??{}))){
   if(typeof files[Number(index)]!=='string'||typeof target!=='string')throw Error('Malformed trace link');
   await inspectFile(base,target);
  }
 }
 async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const full=path.join(dir,entry.name);
   if(entry.isSymbolicLink()){
    // Next may create dependency junctions. Validate their targets without traversing
    // arbitrary linked trees; traced files beneath them are checked separately.
    if(entry.name.endsWith('.nft.json'))throw Error('Linked trace manifest cannot be verified');
    await inspectFile(dir,entry.name);continue;
   }
   if(entry.isDirectory()){if(!['cache','static','standalone'].includes(entry.name))await walk(full);continue;}
   if(!entry.name.endsWith('.nft.json'))continue;
   if((await lstat(full)).size>64*1024*1024)throw Error('Trace exceeds verification size limit');
   const trace=JSON.parse(await readFile(full,'utf8'));manifests++;
   if(!Array.isArray(trace.files))throw Error('Malformed trace manifest');
   for(const file of trace.files)await inspectFile(dir,file);
   await inspectLinks(dir,trace.files,trace.symlinks);
   for(const extra of trace.additionalRoots??[]){
    if(typeof extra.path!=='string'||!Array.isArray(extra.files))throw Error('Malformed additional trace root');
    const base=path.resolve(dir,extra.path);
    for(const file of extra.files)await inspectFile(base,file);
    await inspectLinks(base,extra.files,extra.symlinks);
   }
  }
 }
 await walk(build);
 if(!manifests)throw Error('No production trace manifests found');
 return {manifests,blockedFiles:seen.size,categories:counts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const result=await inspectSensitiveTraces(root);console.log(JSON.stringify(result));if(result.blockedFiles)process.exitCode=1;}
 catch{console.error('Sensitive trace verification failed; no file contents or private paths were printed.');process.exitCode=1;}
}
