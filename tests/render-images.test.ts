import {tinyApng} from './helpers/image-fixtures';
import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,rmdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const security=createRequire(import.meta.url)('../render/security.js');
const svg=(width:number,height:number)=>'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><rect width="100%" height="100%" fill="red"/></svg>');
function withDimensions(png:Buffer,width:number,height:number){
 const copy=Buffer.from(png);copy.writeUInt32BE(width,16);copy.writeUInt32BE(height,20);
 let crc=0xffffffff;for(const value of copy.subarray(12,29)){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}copy.writeUInt32BE((crc^0xffffffff)>>>0,29);return copy;
}
describe('Match metadata-only image limits',()=>{
 it('accepts ordinary raster and generated SVG sources without rewriting bytes',async()=>{
  for(const format of ['png','jpeg','webp','gif'] as const){
   const buffer=await sharp({create:{width:80,height:40,channels:3,background:'blue'}}).toFormat(format).toBuffer();
   const original=Buffer.from(buffer),source='data:image/'+format+';base64,'+buffer.toString('base64');
   expect(await security.validateMatchImageSource(source)).toMatchObject({format,width:80,height:40});expect(buffer.equals(original)).toBe(true);
  }
  expect(await security.validateMatchImageSource(svg(1080,1350))).toMatchObject({format:'svg',width:1080,height:1350});
 });
 it('rejects oversized PNG dimensions/pixel counts by inspecting headers, without allocating the huge raster',async()=>{
  const seed=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
  for(const [width,height] of [[9000,1],[6000,6000]]){
   const bytes=withDimensions(seed,width,height);
   await expect(security.validateMatchImageSource('data:image/png;base64,'+bytes.toString('base64'))).rejects.toMatchObject({statusCode:400});
  }
 });
 it('rejects oversized vectors, malformed bytes and an unlocalized remote URL',async()=>{
  await expect(security.validateMatchImageSource(svg(9000,1))).rejects.toMatchObject({statusCode:400});
  await expect(security.validateMatchImageSource('data:image/png;base64,eA==')).rejects.toMatchObject({statusCode:400});
  await expect(security.validateMatchImageSource(' https://images.example.com/photo.png')).rejects.toMatchObject({statusCode:400});
 });
 it('checks local files and invalidates cached metadata when their contents change',async()=>{
  const parent=resolve('storage');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'image-limit-test-')),file=join(dir,'image.png');
  try{
   writeFileSync(file,await sharp({create:{width:20,height:10,channels:3,background:'red'}}).png().toBuffer());
   const url=pathToFileURL(file).href,options={fileDirectories:[dir]};
   expect(await security.validateMatchImageSource(url,options)).toMatchObject({width:20,height:10});
   writeFileSync(file,'<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>');
   await expect(security.validateMatchImageSource(url,options)).rejects.toMatchObject({statusCode:400});
   writeFileSync(file,Buffer.alloc(20*1024*1024+1));
   await expect(security.validateMatchImageSource(url,options)).rejects.toMatchObject({statusCode:413});
  }finally{rmSync(file,{force:true});rmdirSync(dir);}
 });
});


describe('nested SVG and APNG container policy',()=>{
 it('keeps ordinary vector shapes, text, gradients and internal uses',async()=>{
  const vector='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><path id="p" d="M0 0H10V10Z"/></defs><rect width="100" height="50" fill="url(#g)"/><use href="#p"/><text x="1" y="20">A &amp; B</text></svg>';
  expect(await security.validateMatchImageSource('data:image/svg+xml;base64,'+Buffer.from(vector).toString('base64'))).toMatchObject({format:'svg',width:100,height:50});
 });
 it('rejects nested raster resources, CSS data resources, entity indirection and UTF-16 SVG',async()=>{
  const png=await sharp({create:{width:9000,height:1,channels:3,background:'red'}}).png().toBuffer();
  const nested='data:image/png;base64,'+png.toString('base64');
  const documents=[
   '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image width="1" height="1" href="'+nested+'"/></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/2000/svg" width="1" height="1"><x:image href="'+nested+'"/></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><filter id="f"><feImage href="'+nested+'"/></filter></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>rect{fill:url('+nested+')}</style><rect width="1" height="1"/></svg>',
   '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><use href="d&#97;ta:image/svg+xml,test"/></svg>',
   '<!DOCTYPE svg [<!ENTITY image "'+nested+'">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="&image;"/></svg>',
  ];
  for(const document of documents)await expect(security.validateMatchImageSource('data:image/svg+xml;base64,'+Buffer.from(document).toString('base64'))).rejects.toMatchObject({statusCode:400});
  const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(documents[0],'utf16le')]);
  await expect(security.validateMatchImage(utf16)).rejects.toMatchObject({statusCode:400});
 });
 it('rejects APNG even when Sharp metadata reports no animation pages',async()=>{
  for(const frames of [1,2,101]){
   const image=tinyApng(frames);expect(image.length).toBeLessThan(10000);
   // The rejection must not rely on Sharp exposing pages: the container is authoritative.
   expect((await sharp(image).metadata()).format).toBe('png');
   await expect(security.validateMatchImage(image)).rejects.toMatchObject({statusCode:400});
   await expect(security.validateMatchImageSource('data:image/png;base64,'+image.toString('base64'))).rejects.toMatchObject({statusCode:400});
  }
 });
 it('applies container rejection to local/cache files, including misleading extensions',async()=>{
  const parent=resolve('storage');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'container-test-')),file=join(dir,'image.png');
  try{
   for(const bytes of [tinyApng(),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="data:image/png;base64,AAAA"/></svg>')]){
    writeFileSync(file,bytes);await expect(security.validateMatchImageSource(pathToFileURL(file).href,{fileDirectories:[dir]})).rejects.toMatchObject({statusCode:400});
   }
  }finally{rmSync(file,{force:true});rmdirSync(dir);}
 });
});
