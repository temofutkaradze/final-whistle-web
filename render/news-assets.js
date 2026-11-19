'use strict';
const {randomUUID}=require('node:crypto');
// Request-local immutable bytes. Never fetch a URL or expose local files.
function createNewsAssets(){
  const assets=new Map();
  const add=bytes=>{
    const url=`https://news-assets.invalid/${randomUUID()}`;
    const contentType=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':'image/webp';
    assets.set(url,{body:bytes,contentType});return url;
  };
  const route=route=>{
    const url=route.request().url(),asset=assets.get(url);
    if(asset)return route.fulfill({status:200,...asset});
    return /^(data:|about:)/.test(url)?route.continue():route.abort();
  };
  return {add,route};
}
module.exports={createNewsAssets};
