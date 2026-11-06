'use strict';
const http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,net=require('node:net'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const blocked=new net.BlockList();for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
const global6=new net.BlockList();global6.addSubnet('2000::',3,'ipv6');for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(ip,bits,'ipv6');
function reject(message='Invalid render input',statusCode=400){return Object.assign(new Error(message),{statusCode});}
function publicAddress(address){const family=net.isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!blocked.check(address,'ipv6');}
function publicUrl(value){let url;try{url=new URL(value);}catch{throw reject('Invalid image URL');}const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();if(!['http:','https:'].includes(url.protocol)||url.username||url.password||host==='localhost'||/\.(?:localhost|local|internal|invalid|test)$/.test(host)||(net.isIP(host)&&!publicAddress(host)))throw reject('Blocked image URL');return url;}
function createPublicDownloader({lookup=dns.lookup.bind(dns),request=(url,options,callback)=>(url.protocol==='https:'?https:http).request(url,options,callback)}={}){
 const cache=new Map();
 return async function download(value,{maxBytes=15*1024*1024,timeoutMs=15000,headers={}}={}){
  const deadline=Date.now()+timeoutMs;
  for(let redirects=0;redirects<=4;redirects++){
   const url=publicUrl(value),hostname=url.hostname.replace(/^\[|\]$/g,'');let addresses;
   if(net.isIP(hostname))addresses=[{address:hostname,family:net.isIP(hostname)}];else{const known=cache.get(hostname);if(known?.until>Date.now())addresses=known.addresses;else{let dnsTimer;try{addresses=await Promise.race([lookup(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('Image DNS lookup timed out')),Math.max(1,deadline-Date.now()));dnsTimer.unref?.();})]);}finally{clearTimeout(dnsTimer);}if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw reject('Blocked image destination');if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(hostname,{until:Date.now()+30000,addresses});}}
   if(addresses.some(row=>!publicAddress(row.address)))throw reject('Blocked image destination');
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Image download timed out');
   const result=await new Promise((resolve,rejectPromise)=>{
    let req,timer;const done=(error,result)=>{clearTimeout(timer);error?rejectPromise(error):resolve(result);};
    req=request(url,{method:'GET',headers:{'user-agent':headers['user-agent']||'FinalWhistle/1.0',accept:headers.accept||'*/*'},lookup:(_host,options,callback)=>{const rows=options?.family?addresses.filter(a=>a.family===options.family):addresses;if(!rows.length)return callback(new Error('No approved image address'));return options?.all?callback(null,rows):callback(null,rows[0].address,rows[0].family);}},response=>{
     response.on('error',error=>done(error));
     if([301,302,303,307,308].includes(response.statusCode)){const location=response.headers.location;response.destroy();if(!location)return done(new Error('Invalid image redirect'));try{return done(null,{redirect:new URL(location,url).href});}catch{return done(reject('Invalid image redirect'));}}
     if(response.statusCode<200||response.statusCode>=300){response.destroy();return done(new Error('Image download failed'));}
     const declared=Number(response.headers['content-length']);if(Number.isFinite(declared)&&declared>maxBytes){response.destroy();return done(reject('Image exceeds size limit',413));}
     const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy();req.destroy();done(reject('Image exceeds size limit',413));}else chunks.push(chunk);});
     response.on('end',()=>done(null,{body:Buffer.concat(chunks),headers:response.headers,contentType:String(response.headers['content-type']||'').toLowerCase()}));
    });
    req.on('error',error=>done(error));timer=setTimeout(()=>req.destroy(new Error('Image download timed out')),remaining);timer.unref?.();req.end();
   });
   if(!result.redirect)return result;value=result.redirect;
  }throw reject('Too many image redirects');
 };
}
const downloadPublicResource=createPublicDownloader();
function insideFile(file,directories){
 const requested=path.resolve(file);
 const within=(base,target)=>{const relative=path.relative(base,target);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
 // Reject traversal/UNC/outside paths before any filesystem access or realpath lookup.
 const candidates=directories.filter(dir=>within(path.resolve(dir),requested));
 if(!candidates.length)throw reject('Blocked local image path');
 let actual;try{actual=fs.realpathSync(requested);}catch{throw reject('Invalid local image path');}
 if(!candidates.some(dir=>{try{return within(fs.realpathSync(dir),actual);}catch{return false;}}))throw reject('Blocked local image path');
 if(!/\.(png|jpe?g|webp|gif|svg)$/i.test(actual))throw reject('Invalid local image type');
 return actual;
}
function renderHeaders(){const secret=process.env.NEWS_RENDER_SECRET;if(!secret)throw Object.assign(new Error('Existing renderer key is not configured'),{code:'RENDER_AUTH_CONFIG'});return {'content-type':'application/json','x-news-render-secret':secret};}
function authorized(headers){const secret=process.env.NEWS_RENDER_SECRET,supplied=headers['x-news-render-secret'];if(!secret||typeof supplied!=='string')return false;const a=Buffer.from(secret),b=Buffer.from(supplied);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function readBody(req,maxBytes){if(Number(req.headers['content-length'])>maxBytes)throw reject('Request too large',413);let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw reject('Request too large',413);chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
function eventHtml(value){
 if(value==null)return '';if(typeof value!=='string'||value.length>100000)throw reject('Invalid event markup');
 const tags=/<(\/?)(div|span|br|svg|path|circle)\b([^<>]*?)(\/?)>/gi;
 const remainder=value.replace(tags,(_tag,closing,name,attrs)=>{
  if(closing){if(attrs.trim())throw reject('Unsafe event markup');return '';}
  const rest=attrs.replace(/\s+([A-Za-z][A-Za-z0-9-]*)=(?:"([^"]*)"|'([^']*)')/g,(_attribute,key,a,b)=>{
   const v=a??b;key=key.toLowerCase();let valid=false;
   if(key==='class')valid=/^[A-Za-z0-9 _-]*$/.test(v);
   else if(['width','height','cx','cy','r','stroke-width'].includes(key))valid=/^\d+(?:\.\d+)?$/.test(v)&&Number(v)<=1000;
   else if(key==='viewbox')valid=/^-?[\d.]+(?:\s+-?[\d.]+){3}$/.test(v);
   else if(key==='d')valid=/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(v);
   else if(['fill','stroke'].includes(key))valid=/^(?:#[a-f\d]{3,8}|none|currentColor)$/i.test(v);
   else if(key==='stroke-linecap')valid=/^(round|butt|square)$/.test(v);
   else if(key==='stroke-linejoin')valid=/^(round|bevel|miter)$/.test(v);
   if(!valid)throw reject('Unsafe event markup');return '';
  });
  if(rest.trim())throw reject('Unsafe event markup');return '';
 });
 if(/[<>]/.test(remainder))throw reject('Unsafe event markup');return value;
}
function validateMatch(input){if(!input||typeof input!=='object'||Array.isArray(input))throw reject();for(const key of ['home_team','away_team'])if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>500))throw reject('Invalid team name');for(const key of ['home_score','away_score','total_events'])if(input[key]!=null&&(!Number.isInteger(input[key])||input[key]<0||input[key]>10000))throw reject('Invalid score');if(input.fixture_id!=null&&String(input.fixture_id).length>200)throw reject('Invalid fixture ID');if(input.page_name!=null&&(typeof input.page_name!=='string'||input.page_name.length>500))throw reject('Invalid page name');return {...input,home_events_html:eventHtml(input.home_events_html),away_events_html:eventHtml(input.away_events_html)};}
function imageSource(value,{fileDirectories=[]}={}){if(!value)return '';if(typeof value!=='string'||value.length>24*1024*1024||/[\x00-\x1f]/.test(value))throw reject('Invalid image source');if(/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)(?:;[^,]*)?,/i.test(value))return value;if(/^file:/i.test(value))return require('node:url').pathToFileURL(insideFile(require('node:url').fileURLToPath(value),fileDirectories)).href;return publicUrl(value).href;}
exports.publicAddress=publicAddress;exports.publicUrl=publicUrl;exports.createPublicDownloader=createPublicDownloader;exports.downloadPublicResource=downloadPublicResource;exports.insideFile=insideFile;exports.renderHeaders=renderHeaders;exports.authorized=authorized;exports.readBody=readBody;exports.eventHtml=eventHtml;exports.validateMatch=validateMatch;exports.imageSource=imageSource;

// Bounded FIFO avoids dropping ordinary overlapping bot/preview requests.
function createRenderGate(maxActive=2,maxQueued=4,waitMs=15000){
 let active=0;const queue=[];
 const grant=()=>{active++;let released=false;return ()=>{if(released)return;released=true;active--;const next=queue.shift();if(next){clearTimeout(next.timer);next.resolve(grant());}};};
 return {acquire:()=>{if(active<maxActive)return Promise.resolve(grant());if(queue.length>=maxQueued)return Promise.reject(reject('Renderer busy',429));return new Promise((resolve,rejectPromise)=>{const item={resolve,timer:null};item.timer=setTimeout(()=>{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);rejectPromise(reject('Renderer busy',429));},waitMs);item.timer.unref?.();queue.push(item);});}};
}
exports.createRenderGate=createRenderGate;

// Metadata-only validation preserves the original image bytes and JPG appearance.
const imageMetadataCache=new Map();
const MAX_IMAGE_BYTES=20*1024*1024, MAX_IMAGE_PIXELS=25000000;
// Reject animation chunks even when the image decoder only reports the first PNG frame.
function checkPngContainer(bytes){
  if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return;
  let offset=8;
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if(end>bytes.length)throw reject('Invalid PNG chunk');
    const type=bytes.toString('ascii',offset+4,offset+8);
    if(['acTL','fcTL','fdAT'].includes(type))throw reject('Animated PNG is not supported');
    offset=end;
    if(type==='IEND'){if(length!==0||offset!==bytes.length)throw reject('Invalid PNG ending');return;}
  }
  throw reject('Incomplete PNG');
}
function checkVectorSvg(bytes){
  let svg;try{svg=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw reject('SVG must use UTF-8');}
  // Keep self-contained vector shapes, text, gradients and internal references. No nested resources.
  if(svg.includes('\0')||/<!DOCTYPE|<!ENTITY|&#|\\|data\s*:|@import/i.test(svg)||
     /<\s*(?:[\w.-]+:)?(?:image|feImage|foreignObject|script)\b/i.test(svg)||
     /encoding\s*=\s*["'](?!utf-8["']|utf8["'])/i.test(svg))throw reject('SVG nested resources or unsupported encoding');
  const hrefs=svg.matchAll(/\b(?:[\w.-]+:)?href\s*=\s*(["'])([^"']*)\1/gi);
  for(const match of hrefs)if(!/^#[A-Za-z_][\w:.-]*$/.test(match[2]))throw reject('SVG external reference');
  const withoutInternalUrls=svg.replace(/url\(\s*(["']?)#[A-Za-z_][\w:.-]*\1\s*\)/gi,'');
  if(/url\s*\(/i.test(withoutInternalUrls))throw reject('SVG external CSS resource');
}
async function validateMatchImage(input){
  try {
    const bytes=Buffer.isBuffer(input)?input:await fs.promises.readFile(input);
    if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw reject('Image exceeds byte limit');
    checkPngContainer(bytes);
    const metadata=await require('sharp')(bytes,{limitInputPixels:MAX_IMAGE_PIXELS}).metadata();
    if(metadata.format==='svg')checkVectorSvg(bytes);
    const frames=metadata.pages||1, height=metadata.pageHeight||metadata.height;
    if(!['jpeg','png','webp','gif','svg'].includes(metadata.format)||!metadata.width||!height||metadata.width>8000||height>8000||frames>100||metadata.width*height*frames>MAX_IMAGE_PIXELS)throw reject('Invalid Match image dimensions');
    // Do not retain EXIF/ICC/XMP buffers in the bounded metadata cache.
    return {format:metadata.format,width:metadata.width,height:metadata.height,pages:frames,pageHeight:height};
  }catch(error){throw reject('Invalid or oversized Match image');}
}
async function validateMatchImageSource(source,{fileDirectories=[]}={}){
  if(!source)return null;
  source=imageSource(source,{fileDirectories});
  let input,key;
  if(source.startsWith('file:')){
    input=require('node:url').fileURLToPath(source);
    const stat=fs.statSync(input);
    if(!stat.isFile()||stat.size>MAX_IMAGE_BYTES)throw reject('Match image exceeds size limit',413);
    key=input+':'+stat.size+':'+stat.mtimeMs+':'+stat.ctimeMs;
  }else if(/^data:image\//i.test(source)){
    key=crypto.createHash('sha256').update(source).digest('hex');
    if(imageMetadataCache.has(key))return imageMetadataCache.get(key);
    try{
      const comma=source.indexOf(','),header=source.slice(0,comma),body=decodeURIComponent(source.slice(comma+1));
      if(/;base64$/i.test(header)){
        if(!/^[A-Za-z0-9+/]*={0,2}$/.test(body)||body.length%4!==0)throw Error();
        input=Buffer.from(body,'base64');
      }else input=Buffer.from(body,'utf8');
    }catch{throw reject('Invalid Match image data');}
    if(!input.length||input.length>MAX_IMAGE_BYTES)throw reject('Match image exceeds size limit',413);
  }else throw reject('Remote image must be downloaded before rendering');
  if(imageMetadataCache.has(key))return imageMetadataCache.get(key);
  const metadata=await validateMatchImage(input);
  if(imageMetadataCache.size>=128)imageMetadataCache.delete(imageMetadataCache.keys().next().value);
  imageMetadataCache.set(key,metadata);
  return metadata;
}
exports.validateMatchImage=validateMatchImage;
exports.validateMatchImageSource=validateMatchImageSource;
