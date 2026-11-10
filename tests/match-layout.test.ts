import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {fillPlaceholders} from '@/lib/sample-match';
import {buildEventsHtml} from '../scripts/lib/events.mjs';
import {referenceScenarios} from './fixtures/match-reference-scenarios.mjs';

describe('symbol-only built-in Match layouts in real Chromium',()=>{
 it('centers undistorted team logos beside scores and keeps reference events inside every canvas',async()=>{
  const browser=await chromium.launch();
  try{
   const page=await browser.newPage({viewport:{width:1080,height:1350}});
   await page.route('http*://**',r=>r.abort());
   const font=readFileSync(resolve('render/fonts/montserrat.ttf')).toString('base64');
   for(const template of ['classic','panel','frame','stripe']){
    let html=fillPlaceholders(readFileSync(resolve(`render/templates/${template}.html`),'utf8'),'FICTIONAL QA');
    html=html.replace(/<link[\s\S]*?>/,'').replace('</head>',`<style>@font-face{font-family:Montserrat;src:url(data:font/ttf;base64,${font});font-weight:100 900}</style></head>`);
    await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
    expect(await page.locator('.team-name').count()).toBe(0);
    expect(await page.locator('body').innerText()).not.toContain('FC Alpha');
    expect(await page.locator('body').innerText()).not.toContain('FC Beta');
    const geometry=await page.evaluate(()=>{
     const box=(e:Element)=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,cx:b.x+b.width/2,cy:b.y+b.height/2};};
     return{logos:[...document.querySelectorAll('.team-logo')].map(e=>({...box(e),fit:getComputedStyle(e).objectFit})),score:box(document.querySelector('.score-text')!),lines:[...document.querySelectorAll('.league-line')].map(box)};
    });
    expect(geometry.logos[0].cx+geometry.logos[1].cx,template).toBeCloseTo(1080,0);
    expect(geometry.score.cx,template).toBeCloseTo(540,0);
    for(const logo of geometry.logos){expect(logo.cy,template).toBeCloseTo(geometry.score.cy,0);expect(logo.fit).toBe('contain');}
    if(template==='classic')expect(geometry.lines.map(l=>[l.x,l.y,l.w,l.h])).toEqual([[90,772.5,350,2],[640,772.5,350,2]]);
    for(const scenario of referenceScenarios){
     const events=buildEventsHtml(scenario.events,scenario.match);
     await page.evaluate(({events,hs,as})=>{
      document.querySelector('.team-scorers.left')!.innerHTML=events.home_events_html;
      document.querySelector('.team-scorers.right')!.innerHTML=events.away_events_html;
      document.querySelector('.score-text')!.textContent=`${hs} - ${as}`;
     },{events,hs:scenario.hs,as:scenario.as});
     const bounds=await page.locator('.event').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return{x:b.x,right:b.right,bottom:b.bottom};}));
     for(const b of bounds){expect(b.x,`${template}/${scenario.id}`).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(1080);expect(b.bottom).toBeLessThanOrEqual(1350);}
    }
   }
  }finally{await browser.close();}
 },30000);
 it('keeps custom white originals intact and derives transparent symbols without pixel invention',async()=>{
  const records=JSON.parse(readFileSync('render/assets/leagues/symbols/provenance.json','utf8'));
  for(const id of [78,135]){
   const record=records.find((r:{id:number})=>r.id===id);
   const original=readFileSync(record.source);
   expect(createHash('sha256').update(original).digest('hex')).toBe(record.sourceSha256);
   const crop=await sharp(original).extract(record.crop).png().toBuffer();
   const expected=await sharp(crop).trim({threshold:0}).ensureAlpha().raw().toBuffer();
   const symbol=sharp(`render/assets/leagues/symbols/${id}.png`);
   expect((await symbol.metadata()).hasAlpha).toBe(true);
   const pixels=await symbol.ensureAlpha().raw().toBuffer();expect(pixels).toEqual(expected);
   expect(pixels.some((value,index)=>index%4===3&&value===0)).toBe(true);
  }
 });
});
