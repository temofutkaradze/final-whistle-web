import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const markerPath=path.join(root,'.final-whistle-production-build.json');
const inputFiles=['package.json','package-lock.json','next.config.mjs','tsconfig.json','prisma.config.ts','.env','.env.local','.env.production','.env.production.local'];
const inputDirs=['src','scripts','render','prisma','public'];
const ignored=new Set(['cache','rendered','output']);

export function sourceFingerprint(base=root){
  const hash=createHash('sha256');
  const addFile=relative=>{const file=path.join(base,relative);if(existsSync(file)){hash.update(relative).update('\0').update(readFileSync(file)).update('\0');}};
  for(const file of inputFiles)addFile(file);
  const walk=(dir,relative)=>{
    for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.isSymbolicLink()||ignored.has(entry.name)||entry.name==='.next'||entry.name==='node_modules')continue;
      const name=path.join(relative,entry.name),full=path.join(base,name);
      if(entry.isDirectory())walk(full,name);else if(entry.isFile())addFile(name);
    }
  };
  for(const dir of inputDirs){const full=path.join(base,dir);if(existsSync(full))walk(full,dir);}
  for(const [key,value] of Object.entries(process.env).filter(([key])=>key.startsWith('NEXT_PUBLIC_')).sort(([a],[b])=>a.localeCompare(b)))hash.update(key).update('=').update(value).update('\0');
  return hash.digest('hex');
}

export function markerIsValid(marker,{buildId,fingerprint}){
  return Boolean(marker&&marker.state==='success'&&typeof marker.completedAt==='string'&&marker.buildId===buildId&&marker.sourceFingerprint===fingerprint);
}

function readBuildId(){const file=path.join(root,'.next','BUILD_ID');if(!existsSync(file))throw Error('Production build ID is missing');return readFileSync(file,'utf8').trim();}
function writeState(value){writeFileSync(markerPath,JSON.stringify(value,null,2)+'\n',{encoding:'utf8'});}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const mode=process.argv[2];
  if(mode==='begin')writeState({state:'building',startedAt:new Date().toISOString()});
  else if(mode==='finish'){
    const buildId=readBuildId();
    for(const file of ['required-server-files.json','routes-manifest.json','BUILD_ID'])if(!existsSync(path.join(root,'.next',file)))throw Error(`Build artifact missing: ${file}`);
    writeState({state:'success',completedAt:new Date().toISOString(),buildId,sourceFingerprint:sourceFingerprint()});
  }
  else if(mode==='verify'){
    let marker;try{marker=JSON.parse(readFileSync(markerPath,'utf8'));}catch{throw Error('No valid successful production-build marker; run npm run build.');}
    if(!markerIsValid(marker,{buildId:readBuildId(),fingerprint:sourceFingerprint()}))throw Error('Production build is incomplete or stale; run npm run build before starting services.');
    console.log('Verified successful production build '+marker.buildId);
  }
  else throw Error('Usage: production-build-guard.mjs begin|finish|verify');
}
