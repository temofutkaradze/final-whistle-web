import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';import path from 'node:path';
export async function updateCursor(ownerId,botId,directory=path.resolve('storage/bot-cursors')){
 const dir=path.resolve(directory);const file=path.join(dir,createHash('sha256').update(ownerId+':'+botId).digest('hex')+'.json');
 let offset=0;try{const data=JSON.parse(await readFile(file,'utf8'));if(!Number.isSafeInteger(data.offset)||data.offset<0)throw Error();offset=Number.isFinite(data.acknowledgedAt)&&Date.now()-data.acknowledgedAt>=7*24*60*60*1000?0:data.offset;}catch(error){if(error?.code!=='ENOENT')throw Object.assign(new Error('MATCH_CURSOR_INVALID'),{code:'MATCH_CURSOR_INVALID'});}
 return {offset,checkpoint:async value=>{if(!Number.isSafeInteger(value)||value<offset)throw Error('MATCH_CURSOR_INVALID');await mkdir(dir,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({offset:value,acknowledgedAt:Date.now()}),{mode:0o600,flag:'wx'});await rename(temp,file);offset=value;}};
}
