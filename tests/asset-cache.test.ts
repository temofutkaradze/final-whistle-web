import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {newsPreviewImages} from '../src/lib/news/preview';
const {normalizeStandingsCrest}=createRequire(import.meta.url)('../render/standings-artwork.js');
it('reuses exact preview bytes without allowing consumers to mutate the cache',async()=>{
  const first=await newsPreviewImages(),second=await newsPreviewImages();
  expect(first.background).toEqual(second.background);expect(first.secondary).toEqual(second.secondary);
  first.background.fill(0);expect((await newsPreviewImages()).background).toEqual(second.background);
});
it('cached crests preserve bytes and backing decisions across hits and eviction',async()=>{
  const input=await sharp({create:{width:32,height:32,channels:4,background:'#101010'}}).png().toBuffer();
  const first=await normalizeStandingsCrest(input),second=await normalizeStandingsCrest(input);
  expect(first).toEqual(second);first.png.fill(0);
  expect(await normalizeStandingsCrest(input)).toEqual(second);
  for(let i=0;i<34;i++)await normalizeStandingsCrest(await sharp({create:{width:8,height:8,channels:4,background:{r:i,g:100,b:200,alpha:1}}}).png().toBuffer());
  expect(await normalizeStandingsCrest(input)).toEqual(second);
});
