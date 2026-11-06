import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import sharp from 'sharp';
import {createRequire} from 'node:module';
import {checkTemplateHtml,collectUrls,withCsp} from '../render/template-check.js';
const security=createRequire(import.meta.url)('../render/security.js');
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch();});
afterAll(async()=>{await browser?.close();});
const wrap=(extra:string)=>'<html><head></head><body>'+extra+'{{HOME_NAME}}{{AWAY_NAME}}{{HOME_SCORE}}{{AWAY_SCORE}}</body></html>';
describe('Chromium and validator boundary agreement',()=>{
 it('reproduces the exact encoded SVG URL but rejects it before rendering',async()=>{
  const image='data:image/png;base64,'+(await sharp({create:{width:9000,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
  const html=wrap('<svg><style title="> </style>">.probe{background-image:u&#114;l('+image+')}</style></svg><div class="probe"></div>');
  expect(checkTemplateHtml(html).ok).toBe(false);
  await expect(security.validateMatchImageSource(image)).rejects.toMatchObject({statusCode:400});
  const page=await browser.newPage();try{
   await page.route('**/*',route=>route.abort());await page.setContent(withCsp(html));
   expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.probe')!).backgroundImage.includes('data:image/png'))).toBe(true);
  }finally{await page.close();}
 });
 it('collects and validates every literal fixture image using the same quoted boundaries',async()=>{
  const image='data:image/png;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
  for(const value of ['"','\'']){
   const markup='<svg><style title='+value+'> </style>'+value+'>.probe{background-image:url('+image+')}</style></svg><div class="probe"></div>';
   const html=wrap(markup);expect(checkTemplateHtml(html).ok).toBe(true);
   const urls=collectUrls(html);expect(urls).toContain(image);
   for(const url of urls.filter(url=>url.startsWith('data:')))await expect(security.validateMatchImageSource(url)).resolves.toMatchObject({width:1,height:1});
   const page=await browser.newPage();try{await page.route('**/*',route=>route.abort());await page.setContent(withCsp(html));expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.probe')!).backgroundImage.includes('data:image/png'))).toBe(true);}finally{await page.close();}
  }
 });
 it('rejects a font-labeled PNG that Chromium can otherwise decode as an image',async()=>{
  const uri='data:font/woff;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'blue'}}).png().toBuffer()).toString('base64');
  const html=wrap('<img id="probe" src="'+uri+'">');expect(checkTemplateHtml(html).ok).toBe(false);
  const page=await browser.newPage();try{await page.route('**/*',route=>route.abort());await page.setContent(withCsp(html));expect(await page.evaluate(async()=>{const image=document.querySelector<HTMLImageElement>('#probe')!;await image.decode();return image.naturalWidth;})).toBe(1);}finally{await page.close();}
 });
});

it('collects actual browser images across CSS comment, string and HTML-attribute decoys',async()=>{
 const uri='data:image/png;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 const geometry='position:absolute;left:0;top:0;width:1px;height:1px;';
 const cases=[
  '<style>/* url(\'# */ .probe{'+geometry+'background-image:url('+uri+')} /* \') */</style><div class="probe"></div>',
  '<div title="url(\'#"></div><div style="'+geometry+'background-image:url('+uri+')"></div><div title="\')"></div>',
  '<style>.probe{'+geometry+'content:"url(\'#";background:url('+uri+');--text:"\')"}</style><div class="probe"></div>',
 ];
 for(const markup of cases){
  const html=wrap(markup);expect(checkTemplateHtml(html).errors).toEqual([]);expect(collectUrls(html)).toContain(uri);
  await expect(security.validateMatchImageSource(uri)).resolves.toMatchObject({width:1,height:1});
  const page=await browser.newPage();try{
   await page.route('**/*',route=>route.abort());await page.setContent(withCsp(html));
   const pixel=await sharp(await page.screenshot({clip:{x:0,y:0,width:1,height:1}})).removeAlpha().raw().toBuffer();
   expect([...pixel]).toEqual([255,0,0]);
  }finally{await page.close();}
 }
});
it('blocks SVG animation that Chromium otherwise uses to load an uncollected image',async()=>{
 const uri='data:image/png;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 const html=wrap('<svg width="1" height="1" style="position:absolute;top:0;left:0"><image id="probe" width="1" height="1"/><set title=">" attributeName="href" to="'+uri+'" href="#probe"/></svg>');
 expect(checkTemplateHtml(html).ok).toBe(false);
 const page=await browser.newPage();try{
  await page.route('**/*',route=>route.abort());await page.setContent(withCsp(html));
  await page.waitForFunction(()=>document.querySelector<SVGImageElement>('#probe')?.href.animVal.startsWith('data:image/png'));
  const pixel=await sharp(await page.screenshot({clip:{x:0,y:0,width:1,height:1}})).removeAlpha().raw().toBuffer();expect([...pixel]).toEqual([255,0,0]);
 }finally{await page.close();}
});
