'use strict';
const crypto=require('node:crypto'),fs=require('node:fs/promises'),{fileURLToPath}=require('node:url');
const security=require('./security.js');
const {prepareDocument}=require('./final-document.js');
// Validate immutable bytes, not a path that could change between checking and loading.
async function prepareCustomDocument(source,fileDirectories){
 const {resources}=prepareDocument(source);
 const manifest=new Map(),urls=new Map();let total=0;
 if(resources.length>128)throw Object.assign(new Error('Too many template images'),{statusCode:400});
 // Sequential allocation bounds peak memory even for adversarial repeated embedded images.
 for(const value of resources){
  const safe=security.imageSource(value,{fileDirectories});let bytes;
  if(safe.startsWith('file:')){
   const file=fileURLToPath(safe),stat=await fs.stat(file);
   if(stat.size>20*1024*1024)throw Object.assign(new Error('Image too large'),{statusCode:400});
   bytes=await fs.readFile(file);
  }else{
   const comma=safe.indexOf(','),header=safe.slice(0,comma);let body;
   try{body=decodeURIComponent(safe.slice(comma+1));}catch{throw Object.assign(new Error('Invalid image encoding'),{statusCode:400});}
   if(/;base64$/i.test(header)){
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(body)||body.length%4)throw Object.assign(new Error('Invalid image data'),{statusCode:400});
    bytes=Buffer.from(body,'base64');
   }else bytes=Buffer.from(body,'utf8');
  }
  total+=bytes.length;if(total>64*1024*1024)throw Object.assign(new Error('Template image budget exceeded'),{statusCode:400});
  const metadata=await security.validateMatchImage(bytes);
  const url='https://validated-template.invalid/'+crypto.createHash('sha256').update(bytes).digest('hex');
  const contentType='image/'+(metadata.format==='svg'?'svg+xml':metadata.format==='jpg'?'jpeg':metadata.format);
  manifest.set(url,{body:bytes,contentType});urls.set(value,url);
 }
 const final=prepareDocument(source,{imageUrl:value=>{if(!urls.has(value))throw Object.assign(new Error('Image manifest mismatch'),{statusCode:400});return urls.get(value);}});
 return {html:final.html,manifest};
}
module.exports={prepareCustomDocument};
