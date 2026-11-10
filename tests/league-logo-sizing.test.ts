import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {chromium} from 'playwright';
import {fillPlaceholders} from '@/lib/sample-match';
import {leagueLogoSize,MAX_WIDTH,MAX_HEIGHT,TARGET_ALPHA_AREA} from '../render/league-logo-sizing.js';
import sharp from 'sharp';
const profiles=JSON.parse(readFileSync('render/league-logo-profiles.json','utf8'));
const ids=[39,140,78,135,61,2];
describe('shared optical league logo sizing',()=>{
 it('uses one capped alpha-area rule, including transparent padding, with a bounded Premier League optical correction',()=>{
  for(const id of ids){
   const p=profiles[id],s=leagueLogoSize(id);
   expect(s.width).toBeLessThanOrEqual(MAX_WIDTH);expect(s.height).toBeLessThanOrEqual(MAX_HEIGHT);
   expect(s.width/s.height).toBeCloseTo(p.width/p.height,3);
   const painted=p.alphaArea*(s.width/p.width)**2;
   expect(painted).toBeLessThanOrEqual(TARGET_ALPHA_AREA*(id===39?1.15**2:1)+0.1);
   expect(painted).toBeGreaterThan(800);
  }
  expect(leagueLogoSize(39)).toEqual({width:56,height:56});
  expect(leagueLogoSize(140)).toEqual({width:51.663,height:47.398});
  expect(leagueLogoSize(78)).toEqual({width:72,height:54.472});
  expect(leagueLogoSize(135)).toEqual({width:45.832,height:53.951});
  expect(leagueLogoSize(61)).toEqual({width:36.195,height:56});
  expect(leagueLogoSize(2)).toEqual({width:56.767,height:56});
  expect(leagueLogoSize(140).height).toBeLessThan(48);
  expect(leagueLogoSize(140).width).toBeLessThan(52);
  expect(leagueLogoSize('140')).toEqual({width:72,height:56});
  expect(leagueLogoSize(999)).toEqual({width:72,height:56});
 });
 it('keeps measured coverage in sync with every local symbol asset',async()=>{
  for(const id of ids.filter(id=>id!==39)){
   const {data,info}=await sharp(`render/assets/leagues/symbols/${id}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   let area=0;for(let i=3;i<data.length;i+=4)area+=data[i]/255;
   expect(profiles[id]).toMatchObject({width:info.width,height:info.height});expect(profiles[id].alphaArea).toBeCloseTo(area,3);
  }
 });
 it('changes only league-image bounds and leaves wrapper, team logos, score, events and accent lines fixed in all four templates',async()=>{
  const browser=await chromium.launch();
  try{
   const page=await browser.newPage({viewport:{width:1080,height:1350}});
   await page.route('http*://**',r=>r.abort());
   for(const template of ['classic','panel','frame','stripe']){
    const source=fillPlaceholders(readFileSync(`render/templates/${template}.html`,'utf8'),'FICTIONAL QA').replace(/<link[\s\S]*?>/,'');
    await page.setContent(source);
    const unchanged=()=>page.locator('.league-logo-wrapper,.team-logo,.score-text,.event,.league-line').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,background:getComputedStyle(e).backgroundImage};}));
    const before=await unchanged();
    for(const id of ids){
     await page.locator('.league-logo').evaluate((e,size)=>{(e as HTMLElement).style.width=size.width+'px';(e as HTMLElement).style.height=size.height+'px';},leagueLogoSize(id));
     expect(await unchanged(),`${template}/${id}`).toEqual(before);
     const fit=await page.locator('.league-logo').evaluate(e=>{const b=e.getBoundingClientRect(),w=e.parentElement!.getBoundingClientRect();return{cx:b.x+b.width/2,cy:b.y+b.height/2,wx:w.x+w.width/2,wy:w.y+w.height/2,fit:getComputedStyle(e).objectFit};});
     // Chromium rounds flex centering to 1/64 CSS px.
     expect(Math.abs(fit.cx-fit.wx)).toBeLessThanOrEqual(1/64);expect(Math.abs(fit.cy-fit.wy)).toBeLessThanOrEqual(1/64);expect(fit.fit).toBe('contain');
    }
   }
  }finally{await browser.close();}
 },30000);
});
