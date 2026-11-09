import {describe,it,expect} from 'vitest';
// @ts-expect-error benchmark helpers are intentionally standalone JavaScript
import {compareRgb,median} from '../scripts/quality/metrics.mjs';

describe('quality benchmark measurements',()=>{
 it('reports exact identity and an undefined/infinite PSNR without JSON Infinity',()=>{
  const image=Buffer.alloc(9*11*3,128);
  expect(compareRgb(image,image,9,11)).toEqual({psnrDb:null,identical:true,ssim8:1,maxError:0});
 });
 it('measures a known constant RGB error including partial edge windows',()=>{
  const result=compareRgb(Buffer.alloc(9*11*3,100),Buffer.alloc(9*11*3,110),9,11);
  expect(result.psnrDb).toBeCloseTo(20*Math.log10(255/10),8);
  expect(result.ssim8).toBeCloseTo((2*100*110+6.5025)/(10000+12100+6.5025),8);
  expect(result.maxError).toBe(10);expect(result.identical).toBe(false);
 });
 it('rejects mismatched dimensions instead of reporting misleading metrics',()=>{
  expect(()=>compareRgb(Buffer.alloc(12),Buffer.alloc(15),2,2)).toThrow();
 });
 it('uses the midpoint for even repeat counts without mutating timings',()=>{
  const input=[4,1,3,2];expect(median(input)).toBe(2.5);expect(input).toEqual([4,1,3,2]);
 });
});
