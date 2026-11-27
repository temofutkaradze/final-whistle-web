import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {chromium,type Browser} from 'playwright';
import sharp from 'sharp';
import {editorialTransition,LARGE_HEADLINE_MAX_OFFSET} from '../src/lib/news/editorial';
import {buildEditorialHtml} from '../src/lib/news/editorial-html';
import {bundledFonts} from '../src/lib/news/html';
import {renderNewsPost} from '../src/lib/news/render';
import type {Job} from '../src/lib/news/parse';

const NOW=1_900_000_000_000;
const collection={background:'test-background',circle:null,stage:'collecting',ts:NOW};
function startLarge(){return editorialTransition({text:'Large Headline'},collection,NOW)!;}
function selectManual(){const selected=startLarge();return editorialTransition({text:'Manual'},selected.pending,NOW+1)!;}
function headlineJob(headline:string,layoutMode:'automatic'|'manual'='manual',bottomOffset=128){
  return {layout:'single' as const,author:'',quote:headline,caption:'',pos:{b:[50,50,1] as [number,number,number],c:[50,30,1] as [number,number,number]},editorial:{template:'large-headline' as const,layoutMode,bottomOffset,headline,subtitle:''}};
}
let browser:Browser,background:string;

beforeAll(async()=>{
  browser=await chromium.launch({headless:true});
  background='data:image/png;base64,'+(await sharp({create:{width:8,height:10,channels:3,background:'#263b35'}}).png().toBuffer()).toString('base64');
});
afterAll(async()=>{await browser?.close();vi.unstubAllGlobals();vi.unstubAllEnvs();});

async function inspectManual(headline:string,bottomOffset=128){
  const html=buildEditorialHtml(headlineJob(headline,'manual',bottomOffset),background,bundledFonts);
  const page=await browser.newPage({viewport:{width:2160,height:2700},deviceScaleFactor:1});
  try{
    await page.setContent(html,{waitUntil:'domcontentloaded',timeout:10000});
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-ready')==='1',null,{timeout:10000});
    return await page.evaluate(()=>{
      const el=document.querySelector<HTMLElement>('#headline')!;const range=document.createRange();range.selectNodeContents(el);
      const tops=[...range.getClientRects()].map(r=>Math.round(r.top));
      return {text:el.textContent,font:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight,
        fontFamily:getComputedStyle(el).fontFamily,fontWeight:getComputedStyle(el).fontWeight,
        whiteSpace:getComputedStyle(el).whiteSpace,overflowWrap:getComputedStyle(el).overflowWrap,
        lineCount:new Set(tops).size,scrollWidth:el.scrollWidth,width:el.clientWidth,
        childSizes:[...el.querySelectorAll('span')].map(span=>getComputedStyle(span).fontSize),
        bottom:getComputedStyle(document.querySelector('.copy')!).bottom,
        error:document.documentElement.getAttribute('data-error')};
    });
  }finally{await page.close();}
}

describe('Large Headline Telegram layout selection',()=>{
  it('offers Automatic and Manual after Large Headline is selected',()=>{
    const result=startLarge();
    expect(result).toMatchObject({pending:{stage:'editorial',template:'large-headline',step:'layout'}});
    expect((result as any).replyOptions.reply_markup.keyboard[0]).toEqual([{text:'Automatic'},{text:'Manual'}]);
  });

  it('Automatic asks for text and uses the Variant D defaults',()=>{
    const selected=startLarge();const mode=editorialTransition({text:'Automatic'},selected.pending,NOW+2)!;
    expect(mode).toMatchObject({pending:{step:'headline',layoutMode:'automatic'},reply:'Enter the headline. Use *words* for yellow highlights.'});
    const result=editorialTransition({text:'FIRST LINE\nSECOND LINE'},mode.pending,NOW+3)!;
    expect(result).toMatchObject({job:{editorial:{template:'large-headline',layoutMode:'automatic',headline:'FIRST LINE\nSECOND LINE'}}});
    const job=(result as {job?:Job}).job!;
    const html=buildEditorialHtml(job,background,bundledFonts);
    expect(html).toContain('.copy{position:absolute;left:40px;right:40px;bottom:128px;');
    expect(html).toContain("font:400 94px/1.04 Anton,'League Gothic',Impact,sans-serif");
    expect(html).toContain('white-space:pre-wrap;overflow-wrap:anywhere;text-wrap:balance');
  });

  it('Manual offers the default button and accepts pixel suffixes',()=>{
    const result=selectManual();
    expect(result).toMatchObject({pending:{step:'offset',layoutMode:'manual',bottomOffset:128},reply:'Enter the bottom offset in pixels. Default: 128 px. Higher values move the headline upward.'});
    expect((result as any).replyOptions.reply_markup.keyboard[0]).toEqual([{text:'Default (128 px)'}]);
    for(const [value,expected] of [['92',92],['128px',128],['128 px',128],['160',160],['Default (128 px)',128]] as const){
      const parsed=editorialTransition({text:value},result.pending,NOW+2)!;
      expect(parsed).toMatchObject({pending:{step:'headline',bottomOffset:expected}});
    }
  });

  it('rejects invalid or out-of-canvas offsets and keeps the offset prompt active',()=>{
    const start=selectManual();
    for(const value of ['-1','1001','NaN','12 pixels','']){
      const result=editorialTransition({text:value},start.pending,NOW+2)!;
      expect(result).toMatchObject({pending:{step:'offset'},reply:expect.stringContaining(`0 to ${LARGE_HEADLINE_MAX_OFFSET}`)});
    }
  });

  it('keeps exact one-, two-, and three-line manual text in the job',()=>{
    for(const headline of ['ONE LINE','FIRST\nSECOND','FIRST\nSECOND\nTHIRD']){
      const offset=editorialTransition({text:'160 px'},selectManual().pending,NOW+2)!;
      const result=editorialTransition({text:headline},offset.pending,NOW+3)!;
      expect(result).toMatchObject({job:{editorial:{template:'large-headline',layoutMode:'manual',bottomOffset:160,headline}}});
      expect((result as {job?:Job}).job?.editorial?.headline).toBe(headline);
    }
  });

  it('preserves Back and Cancel navigation in the new mode steps',()=>{
    expect(editorialTransition({text:'Back'},startLarge().pending,NOW+2)).toMatchObject({returnToTemplates:true});
    expect(editorialTransition({text:'Back'},selectManual().pending,NOW+2)).toMatchObject({pending:{step:'layout'}});
    expect(editorialTransition({text:'Cancel'},selectManual().pending,NOW+2)).toMatchObject({pending:null});
  });

  it('keeps older Large Headline pending jobs on Automatic with Variant D defaults',()=>{
    const oldPending={stage:'editorial',background:'test-background',template:'large-headline',step:'headline',ts:NOW};
    const result=editorialTransition({text:'OLD JOB HEADLINE'},oldPending,NOW+1)!;
    expect(result).toMatchObject({job:{editorial:{template:'large-headline',layoutMode:'automatic',headline:'OLD JOB HEADLINE'}}});
    expect(buildEditorialHtml((result as {job?:Job}).job!,background,bundledFonts)).toContain('.copy{position:absolute;left:40px;right:40px;bottom:128px;');
  });

  it('does not add layout choices to other editorial templates',()=>{
    const result=editorialTransition({text:'Headline + Subtitle'},collection,NOW)!;
    expect(result).toMatchObject({pending:{template:'headline-subtitle',step:'headline'}});
    expect(result).not.toHaveProperty('replyOptions');
    const html=buildEditorialHtml({layout:'single',author:'',quote:'',caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template:'headline-subtitle',headline:'A HEADLINE',subtitle:'A SUBTITLE'}},background,bundledFonts);
    expect(html).toContain('.copy{position:absolute;left:70px;right:70px;bottom:92px;');
    expect(html).toContain('font:400 80px/1.04 Anton');
  });
});

describe('Large Headline manual browser layout',()=>{
  it.each([
    {headline:'ONE LINE',lineCount:1},
    {headline:'FIRST LINE\nSECOND LINE',lineCount:2},
    {headline:'FIRST\nSECOND\nTHIRD',lineCount:3},
  ])('renders exactly $lineCount manual line(s)',async({headline,lineCount})=>{
    const result=await inspectManual(headline,128);
    expect(result.text).toBe(headline);
    expect(result.whiteSpace).toBe('pre');
    expect(result.overflowWrap).toBe('normal');
    expect(result.lineCount).toBe(lineCount);
    expect(result.error).toBeNull();
    expect(result.bottom).toBe('128px');
  });

  it('uniformly fits a long line with the loaded Anton font without reflow',async()=>{
    const headline='CHELSEA REPORTEDLY TARGET ALEX SCOTT FOR JANUARY\nALEX SCOTT FOR JANUARY';
    const result=await inspectManual(headline,160);
    expect(result.error).toBeNull();
    expect(result.text).toBe(headline);
    expect(result.lineCount).toBe(2);
    expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
    expect(parseFloat(result.font)).toBeLessThan(94);
    expect(parseFloat(result.font)).toBeGreaterThanOrEqual(32);
    expect(result.fontFamily).toContain('Anton');
    expect(result.childSizes.every(size=>size===result.font)).toBe(true);
    expect(result.bottom).toBe('160px');
  });

  it('flags manual text that cannot fit safely rather than rewrapping it',async()=>{
    const headline=Array.from({length:38},(_,i)=>`L${i+1}`).join('\n');
    const result=await inspectManual(headline,128);
    expect(result.error).toBe('NEWS_MANUAL_LAYOUT_UNSAFE');
    expect(result.text).toBe(headline);
  });
});

describe('manual fit response from the existing News renderer client',()=>{
  it('returns a safe, specific error for a 422 manual-layout response',async()=>{
    vi.stubEnv('NEWS_RENDER_SECRET','test-key');
    vi.stubEnv('RENDER_SERVER_URL','http://127.0.0.1:4500');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:'NEWS_MANUAL_LAYOUT_UNSAFE',error:'Manual Large Headline does not fit safely.'}),{status:422,headers:{'content-type':'application/json'}})));
    await expect(renderNewsPost(headlineJob('LINE\nLINE'),Buffer.from('image'),null)).rejects.toMatchObject({code:'NEWS_MANUAL_LAYOUT_UNSAFE'});
  });
});
