import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {buildHtml} from '@/lib/news/html';
import {buildJob,DEFAULT_NEWS_STYLE} from '@/lib/news/parse';
import {newsPreviewImages} from '@/lib/news/preview';
let browser:Browser,page:Page,background:Buffer,secondary:Buffer;
beforeAll(async()=>{({background,secondary}=await newsPreviewImages());browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:2160,height:2700}});await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():r.abort());});
afterAll(async()=>{await browser?.close();});
async function load(layout:'single'|'left'|'right'|'breaking',custom=false){const job=buildJob(layout==='breaking'?'BREAKING | Summary must not appear':'Author | Sample headline',['left','right'].includes(layout),layout);job.author='FABRIZIO ROMANO';if(custom)job.style={...DEFAULT_NEWS_STYLE,textBottom:80};await page.setContent(buildHtml(job,background,['left','right'].includes(layout)?secondary:null));await page.waitForFunction(()=>document.documentElement.getAttribute('data-ready')==='1');}
describe('built-in BREAKING typography',()=>{
 it('uses a large centered condensed white headline inside a completely closed red border',async()=>{
  await load('breaking');const result=await page.locator('.breaking-frame').evaluate(frame=>{const f=frame.getBoundingClientRect(),s=getComputedStyle(frame),t=getComputedStyle(frame.querySelector('span')!);return {left:f.left/2,right:f.right/2,top:f.top/2,bottom:f.bottom/2,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],styles:[s.borderTopStyle,s.borderRightStyle,s.borderBottomStyle,s.borderLeftStyle],colors:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor],font:t.fontFamily,size:parseFloat(t.fontSize),ink:t.color};});
  expect(result.borders).toEqual(['2px','2px','2px','2px']);expect(result.styles).toEqual(['solid','solid','solid','solid']);expect(new Set(result.colors)).toEqual(new Set(['rgb(229, 45, 50)']));expect(result.font).toContain('Anton');expect(result.ink).toBe('rgb(255, 255, 255)');expect(result.size).toBeGreaterThanOrEqual(200);expect(result.left).toBe(60);expect(result.right).toBe(1020);expect(result.top).toBeGreaterThan(900);expect(result.bottom).toBeLessThan(1350);
 });
 it('shows no separate news caption or attribution',async()=>{await load('breaking');expect(await page.locator('.breaking-summary').count()).toBe(0);expect(await page.locator('#a').isVisible()).toBe(false);expect(await page.locator('#q').isVisible()).toBe(false);expect(await page.locator('.breaking-frame').innerText()).toBe('BREAKING');});
 it('retains independently customized BREAKING typography and summary',async()=>{await load('breaking',true);expect(await page.locator('.breaking-headline').count()).toBe(0);expect(await page.locator('.breaking-summary').isVisible()).toBe(true);expect(await page.locator('.breaking-frame span').evaluate(e=>getComputedStyle(e).fontSize)).toBe('118px');});
 it.each(['single','left','right'] as const)('leaves the %s headline and author layout active',async layout=>{await load(layout);expect(await page.locator('.breaking-frame').count()).toBe(0);expect(await page.locator('#q').isVisible()).toBe(true);expect(await page.locator('#a').isVisible()).toBe(true);});
});
