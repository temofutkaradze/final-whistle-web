import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {downloadPublicResource} from '../../render/security.js';
export const BACKGROUND_DIR=path.join(process.cwd(),'storage','backgrounds');
export async function downloadBackground(brandId,url){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(brandId))throw new Error('Invalid background ID');
  const resource=await downloadPublicResource(url,{maxBytes:15*1024*1024,timeoutMs:15000});
  const type=resource.contentType;
  const ext=type.includes('png')?'png':type.includes('webp')?'webp':type.includes('jpeg')||type.includes('jpg')?'jpg':null;
  if(!ext)throw new Error('Background must be a PNG, JPEG or WebP image.');
  await mkdir(BACKGROUND_DIR,{recursive:true});
  const file=path.join(BACKGROUND_DIR,`${brandId}.${ext}`);
  await writeFile(file,resource.body);return file;
}
