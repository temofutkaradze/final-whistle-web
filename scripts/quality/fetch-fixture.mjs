// Optional public CC0 fixture setup. No credentials, production data, or AI imagery.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const target=path.resolve('storage/quality/fixtures/photo-landscape-original.jpg');
const expected='b8cea8e572803cfdbd3854271f0aca88cbf526b9998d9ec7870aaeabe3f2529b';
const url='https://get.pxhere.com/photo/people-sport-field-game-soccer-football-player-men-team-american-football-sports-uniform-championship-players-athletes-football-player-ball-game-team-sport-1102099.jpg';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
try{const existing=await fs.readFile(target);if(digest(existing)!==expected)throw Error('Existing fixture differs; refusing overwrite');console.log('Fixture already verified');}
catch(e){
 if(e.code!=='ENOENT')throw e;
 const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Public fixture download unavailable');
 const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>15*1024*1024)throw Error('Fixture too large');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);if(digest(bytes)!==expected)throw Error('Public fixture changed; manual source review required');
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});console.log('CC0 fixture verified');
}
