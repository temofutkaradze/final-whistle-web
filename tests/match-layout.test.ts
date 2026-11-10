import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {describe,expect,it} from 'vitest';
import {fitClassicTeamNames} from '../render/match-layout.js';
import {fillPlaceholders} from '@/lib/sample-match';
describe('Classic reference typography in real Chromium',()=>{
 it('fits the long reference name without changing normal typography or league lines',async()=>{
  const browser=await chromium.launch();
  try{
   const page=await browser.newPage({viewport:{width:1080,height:1350}});
   const font=readFileSync(resolve('render/fonts/montserrat.ttf')).toString('base64');
   let html=fillPlaceholders(readFileSync(resolve('render/templates/classic.html'),'utf8'),'DAY\nON\nFOOTBALL');
   html=html.replace(/<link[\s\S]*?>/,'').replace('</head>',`<style>@font-face{font-family:Montserrat;src:url(data:font/ttf;base64,${font});font-weight:100 900}</style></head>`);
   await page.route('http*://**',r=>r.abort());
   await page.setContent(html);
   await page.evaluate(async()=>{await document.fonts.ready;const names=document.querySelectorAll('.team-name');names[0].textContent='BORUSSIA MÖNCHENGLADBACH';names[1].textContent='DORTMUND';});
   const before=await page.evaluate(()=>({names:[...document.querySelectorAll('.team-name')].map(e=>getComputedStyle(e).fontSize),lines:[...document.querySelectorAll('.league-line')].map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})}));
   await fitClassicTeamNames(page);
   const after=await page.evaluate(()=>({names:[...document.querySelectorAll('.team-name')].map(e=>{const r=document.createRange();r.selectNodeContents(e);return{font:getComputedStyle(e).fontSize,ink:r.getBoundingClientRect().width,box:e.getBoundingClientRect().width};}),lines:[...document.querySelectorAll('.league-line')].map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})}));
   expect(after.names[0].ink).toBeLessThanOrEqual(after.names[0].box+0.5);
   expect(parseFloat(after.names[0].font)).toBeLessThan(parseFloat(before.names[0]));
   expect(after.names[1].font).toBe(before.names[1]);
   expect(after.lines).toEqual(before.lines);
  }finally{await browser.close();}
 });
});
