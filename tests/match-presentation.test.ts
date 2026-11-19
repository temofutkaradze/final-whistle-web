import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {chromium} from 'playwright';
import {fillPlaceholders} from '../src/lib/sample-match';
const {competitionLabel,applyMatchPresentation,fitMatchComposition}=createRequire(import.meta.url)('../render/match-presentation.js');
const templates=['classic','panel','frame','stripe'];

describe('built-in Match composition and competition labels',()=>{
 it('maps exact API-Football identities without inferring subscription access',()=>{
  expect(competitionLabel(5)).toBe('UNL');expect(competitionLabel(6)).toBe('CAF');
  for(const id of [undefined,39,135,'5',NaN,999])expect(competitionLabel(id)).toBeNull();
 });
 it('moves every related element together and reserves clearance for eight scorer rows',async()=>{
  const browser=await chromium.launch();
  try{const page=await browser.newPage({viewport:{width:1080,height:1350}});await page.route('http*://**',r=>r.abort());
   for(const template of templates){
    const html=fillPlaceholders(readFileSync(`render/templates/${template}.html`,'utf8'),'FICTIONAL');
    const geometry=()=>page.locator('.league-logo-wrapper,.league-line,.score-text,.team-logo,.event,.band').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
    await page.setContent(html);await page.evaluate(()=>document.fonts.ready);const before=await geometry();
    const updated=applyMatchPresentation(html,{leagueId:135,template});await page.setContent(updated);await page.evaluate(()=>document.fonts.ready);
    expect(await fitMatchComposition(page,template)).toBe(40);const after=await geometry();
    after.forEach((r,i)=>{expect(r.x).toBeCloseTo(before[i].x);expect(r.y-before[i].y).toBeCloseTo(40);expect(r.w).toBeCloseTo(before[i].w);expect(r.h).toBeCloseTo(before[i].h);});
    await page.locator('.team-scorers.left').evaluate(e=>{const event=e.querySelector('.event')!;e.replaceChildren(...Array.from({length:8},()=>event.cloneNode(true)));});
    await fitMatchComposition(page,template);
    const bounds=await page.locator('.event').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();const p=e.parentElement!.getBoundingClientRect();return{bottom:r.bottom,top:r.top,parentBottom:p.bottom};}));
    for(const b of bounds){expect(b.bottom).toBeLessThanOrEqual(1320.01);expect(b.bottom).toBeLessThanOrEqual(b.parentBottom+.01);expect(b.top).toBeGreaterThan(80);}
    // Repeated fitting is stable, including after fonts have already settled.
    const stable=await geometry();await fitMatchComposition(page,template);expect(await geometry()).toEqual(stable);
   }
  }finally{await browser.close();}
 },60000);
 it('renders UNL/CAF text with symmetrical pure-white 2px lines in every built-in',async()=>{
  const browser=await chromium.launch();
  try{const page=await browser.newPage({viewport:{width:1080,height:1350}});await page.route('http*://**',r=>r.abort());
   for(const template of templates)for(const leagueId of [5,6]){
    const html=fillPlaceholders(readFileSync(`render/templates/${template}.html`,'utf8'),'FICTIONAL');
    await page.setContent(applyMatchPresentation(html,{leagueId,template}));
    expect(await page.locator('.competition-label').textContent()).toBe(leagueId===5?'UNL':'CAF');expect(await page.locator('.league-logo').count()).toBe(0);
    const lines=await page.evaluate(()=>{const es=[...document.querySelectorAll('.league-line')];if(es.length)return es.map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{color:s.backgroundColor,height:r.height,width:r.width,y:r.y};});const e=document.querySelector('.league-logo-wrapper')!;return ['::before','::after'].map(p=>{const s=getComputedStyle(e,p);return{color:s.backgroundColor,height:parseFloat(s.height),width:parseFloat(s.width),y:parseFloat(s.top)};});});
    expect(lines).toHaveLength(2);for(const line of lines){expect(line.color).toBe('rgb(255, 255, 255)');expect(line.height).toBe(2);}expect(lines[0].width).toBeCloseTo(lines[1].width);expect(lines[0].y).toBeCloseTo(lines[1].y);
   }
  }finally{await browser.close();}
 },60000);
});
