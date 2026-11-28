import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { originalNewsTransition, BACKGROUND_SAVED, CIRCLE_SAVED } from '@/lib/news/conversation';
import { buildOriginalJob, DEFAULT_NEWS_STYLE } from '@/lib/news/parse';
import { buildHtml } from '@/lib/news/html';
// @ts-expect-error Runtime JavaScript module has no declaration file.
import { createNewsHandler } from '../scripts/lib/news-core.mjs';
// @ts-expect-error Runtime JavaScript module has no declaration file.
import { inspectNewsTelegram } from '../scripts/lib/news-preflight.mjs';

const now = 10_000_000;
const photo = {photo:[{file_id:'small'},{file_id:'background'}],caption:'Ignored caption'};
function fixture(linked = true) {
  const settings:any={userId:'owner',botToken:'encrypted-test-token',telegramChatId:linked?'42':null,lastUpdateId:null,pending:null,defaultTemplateRef:'custom'};
  const table={findUnique:vi.fn(async()=>({...settings})),updateMany:vi.fn(async({where,data}:any)=>{
    if(where.botToken!==settings.botToken || ('telegramChatId' in where && where.telegramChatId!==settings.telegramChatId))return {count:0};
    if(where.OR && settings.lastUpdateId!==null && settings.lastUpdateId>=where.OR[1].lastUpdateId.lt)return {count:0};
    if(where.linkCodeHash && (where.linkCodeHash!==settings.linkCodeHash || settings.linkExpiresAt<=where.linkExpiresAt.gt))return {count:0};
    Object.assign(settings,data);return {count:1};
  })};
  const config={...DEFAULT_NEWS_STYLE,accent:'#123456',textSize:80};
  const tg={sendMessage:vi.fn(async(..._args:unknown[])=>({ok:true})),sendDocument:vi.fn(async()=>{})};
  const render=vi.fn(async(..._args:unknown[])=>'/fake/news.png');
  const cleanup=vi.fn(async()=>{});
  const diagnostic=vi.fn();
  const handle=createNewsHandler({prisma:{newsSettings:table,newsTemplate:{findFirst:vi.fn(async()=>({config}))}},tg,ownerId:'owner',connectionToken:settings.botToken,download:vi.fn(async()=>Buffer.from('image')),render,cleanup,now:()=>now,onDiagnostic:diagnostic});
  const update=(id:number,message:Record<string,unknown>,chat=42)=>({update_id:id,message:{chat:{id:chat,type:'private'},from:{id:chat},...message}});
  return {settings,tg,render,cleanup,diagnostic,handle,update,config};
}

describe('News original conversation',()=>{
  it('selects the largest Photo even when sizes arrive out of order',()=>{
    expect(originalNewsTransition({photo:[{file_id:'largest',width:1638,height:2048},{file_id:'small',width:320,height:400}]},null,now)).toMatchObject({pending:{background:'largest'}});
  });
  it('takes the largest photo and ignores its caption',()=>{
    expect(originalNewsTransition(photo,null,now)).toEqual({pending:{background:'background',circle:null,ts:now},reply:BACKGROUND_SAVED});
  });
  it('takes an uploaded image document as the background',()=>{
    expect(originalNewsTransition({document:{file_id:'file',mime_type:'image/jpeg'}},null,now)).toMatchObject({pending:{background:'file'}});
  });
  it('collects the circle, then uses R: and a separate text message',()=>{
    const p=originalNewsTransition(photo,{background:'first',ts:now},now);
    expect(p).toMatchObject({reply:CIRCLE_SAVED,pending:{background:'first',circle:'background'}});
    expect(originalNewsTransition({text:'R: Author | A *highlight* || caption'},p.pending,now)).toMatchObject({pending:null,background:'first',circle:'background',job:{layout:'right',author:'Author',quote:'A *highlight*',caption:'caption'}});
  });
  it('starts a fresh background after two saved images',()=>{
    expect(originalNewsTransition(photo,{background:'old',circle:'old-circle',ts:now},now)).toMatchObject({pending:{background:'background',circle:null}});
  });
  it('expires interrupted conversations and supports cancel',()=>{
    expect(originalNewsTransition({text:'Author | News'},{background:'old',ts:0},now)).toMatchObject({pending:null,reply:expect.stringContaining('BACKGROUND image first')});
    expect(originalNewsTransition({text:'/cancel'},{background:'old',ts:now},now)).toEqual({pending:null,reply:'Cleared. Send a new background image.'});
  });
  it('keeps original BREAKING layout and caption-parsing limitation',()=>{
    expect(buildOriginalJob('BREAKING | Headline || literal',true)).toMatchObject({layout:'breaking',quote:'Headline || literal',caption:''});
  });
});

describe('News quote typography fitting',()=>{
  it('keeps the configured quote size until the vertical safe area requires shrinking',()=>{
    const html=buildHtml(buildOriginalJob('AUTHOR | A *SHORT QUOTE*',false),Buffer.from('background'),null,()=> 'data:image/png;base64,AA==');
    expect(html).toContain('font-size:96px');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('safeTop=postRect.top+580*scale');
    expect(html).toContain('function quoteFits(){return q.scrollWidth<=q.clientWidth+1&&bottom.getBoundingClientRect().top>=safeTop;}');
    expect(html).toContain('while(fs>40&&!quoteFits()){fs-=1;q.style.fontSize=fs+\'px\';}');
    expect(html).not.toContain('lines()>3');
    expect(html).not.toContain('fs>84');
    expect(html).toContain('<span class="y">SHORT QUOTE</span>');
  });
});

describe('News bot integration with mocked Telegram and persistence',()=>{
  it('retains the rendered file path after an ambiguous News document delivery',async()=>{
    const f=fixture();f.tg.sendDocument.mockRejectedValueOnce(new Error('network timeout'));
    await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'AUTHOR | A HEADLINE'}));await f.handle(f.update(3,{text:'No'}));
    expect(f.settings.pending).toMatchObject({stage:'sending',requestId:3,outputPath:'/fake/news.png'});
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it('retains a News output after Telegram rate limiting so the retryable result is not swept',async()=>{
    const f=fixture();f.tg.sendDocument.mockRejectedValueOnce(Object.assign(new Error('rate limited'),{telegramCode:429}));
    await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'AUTHOR | A HEADLINE'}));await f.handle(f.update(3,{text:'No'}));
    expect(f.settings.pending).toMatchObject({stage:'sending',requestId:3,outputPath:'/fake/news.png'});
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it('resumes a persisted rendering stage after the same Telegram update is replayed',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'AUTHOR | A NEWS HEADLINE'}));f.render.mockRejectedValueOnce(Error('temporary renderer interruption'));
    const retry=f.update(3,{text:'No'});await f.handle(retry);
    expect(f.settings.pending).toMatchObject({stage:'rendering',requestId:3,background:'background',job:{quote:'A NEWS HEADLINE'}});
    await f.handle(retry);
    expect(f.render).toHaveBeenCalledTimes(2);expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.settings.pending).toMatchObject({stage:'delivered',requestId:3});
  });
  it.each([1,3])('returns %s Branding photos after one selection',async count=>{
    const f=fixture();
    for(let i=0;i<count;i++)await f.handle(f.update(i+1,{photo:[{file_id:`photo-${i}`}],...(count>1?{media_group_id:'album'}:{})}));
    await f.handle(f.update(count+1,{text:'Branding'}));
    expect(f.render).toHaveBeenCalledTimes(count);
    for(const call of f.render.mock.calls)expect(call[0]).toMatchObject({brandingOnly:true,branding:true,quote:'',author:''});
    expect(f.tg.sendDocument).toHaveBeenCalledTimes(count);
    expect(f.settings.pending.stage).toBe('delivered');
    expect(f.diagnostic).not.toHaveBeenCalled();
  });
  it('reports a Branding render failure instead of silently leaving the user waiting',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));
    f.render.mockRejectedValueOnce(new Error('render failed'));
    await f.handle(f.update(2,{text:'Branding'}));
    expect(f.tg.sendMessage.mock.calls.at(-1)?.[1]).toContain('branded photo could not be completed');
    expect(f.tg.sendDocument).not.toHaveBeenCalled();
  });
  for(const withText of [false,true])it('Breaking '+(withText?'Yes':'No')+' uses the selected background and PNG document flow',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'Breaking'}));
    expect(f.tg.sendMessage.mock.calls.at(-1)).toMatchObject(['42','Do you want to add text?',{reply_markup:{keyboard:[[{text:'Yes'},{text:'No'}]]}}]);
    await f.handle(f.update(3,{text:withText?'Yes':'No'}));
    if(withText){expect(f.render).not.toHaveBeenCalled();await f.handle(f.update(4,{text:'A *NEW CHAPTER* BEGINS'}));}
    expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendMessage.mock.calls.at(-1)?.[1]).toBe('Add branding?');await f.handle(f.update(5,{text:'Yes'}));
    expect(f.render).toHaveBeenCalledOnce();expect(f.render.mock.calls[0][0]).toMatchObject({branding:true,layout:'breaking',breakingText:withText,quote:withText?'A *NEW CHAPTER* BEGINS':'',author:''});expect(f.tg.sendDocument).toHaveBeenCalledExactlyOnceWith('42','/fake/news.png','','news-post.png');
  });
  it('Quotes button resumes the complete original circle, author, crop, caption and styling workflow',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));
    expect(f.tg.sendMessage.mock.calls[0]).toMatchObject(['42',expect.any(String),{reply_markup:{keyboard:expect.arrayContaining([[{text:'Quotes'}]])}}]);
    await f.handle(f.update(2,{text:'Quotes'}));expect(f.settings.pending).toMatchObject({background:'background',circle:null});expect(f.render).not.toHaveBeenCalled();
    await f.handle(f.update(3,{document:{file_id:'circle-original',mime_type:'image/png'}}));
    await f.handle(f.update(4,{text:'R: Original Author | A *yellow* quote [b:40,55,1.2] [c:60,20,1.3] || Original caption'}));
    await f.handle(f.update(5,{text:'No'}));
    const job=f.render.mock.calls[0][0];expect(job).toMatchObject({layout:'right',author:'Original Author',quote:'A *yellow* quote',caption:'Original caption',pos:{b:[40,55,1.2],c:[60,20,1.3]},style:expect.objectContaining({accent:f.config.accent,textSize:80})});
    expect(job).not.toHaveProperty('editorial');expect(f.tg.sendDocument).toHaveBeenCalledExactlyOnceWith('42','/fake/news.png','Original caption','news-post.png');
  });
  for(const label of ['Headline + Subtitle','Large Headline','NEWS (Red)','DID YOU KNOW (Yellow)'])it('adds '+label+' without replacing the legacy conversation',async()=>{
    const f=fixture();await f.handle(f.update(1,{document:{file_id:'full-quality-background',file_name:'photo.webp',mime_type:'application/octet-stream'}}));
    expect(f.tg.sendMessage.mock.calls[0]).toMatchObject(['42',expect.any(String),{reply_markup:{keyboard:expect.arrayContaining([[{text:label}]]),resize_keyboard:true,one_time_keyboard:true}}]);
    await f.handle(f.update(2,{text:label}));
    if(label==='Large Headline'){expect(f.settings.pending.step).toBe('layout');await f.handle(f.update(3,{text:'Automatic'}));}
    if(label==='NEWS (Red)'||label==='DID YOU KNOW (Yellow)'){expect(f.settings.pending.step).toBe('version');await f.handle(f.update(3,{text:'Version 1'}));}
    expect(f.settings.pending.step).toBe('headline');
    const headlineUpdate=4;
    await f.handle(f.update(headlineUpdate,{text:'THE *NEXT\nCHAPTER*'}));
    if(label==='Headline + Subtitle'){expect(f.render).not.toHaveBeenCalled();await f.handle(f.update(5,{text:'An editable *subtitle*'}));}
    expect(f.render).not.toHaveBeenCalled();await f.handle(f.update(headlineUpdate+(label==='Headline + Subtitle'?2:1),{text:'No'}));
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0][0]).toMatchObject({branding:false,layout:'single',quote:'THE *NEXT\nCHAPTER*',editorial:{headline:'THE *NEXT\nCHAPTER*',subtitle:label==='Headline + Subtitle'?'An editable *subtitle*':''}});
    expect(f.tg.sendDocument).toHaveBeenCalledOnce();expect(f.settings.pending.stage).toBe('delivered');
  });
  it('offers Automatic and Manual for Large Headline and carries exact manual lines and offset into the job',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'Large Headline'}));
    expect((f.tg.sendMessage.mock.calls.at(-1)?.[2] as any).reply_markup.keyboard[0]).toEqual([{text:'Automatic'},{text:'Manual'}]);
    await f.handle(f.update(3,{text:'Manual'}));
    expect(f.tg.sendMessage.mock.calls.at(-1)?.[0]).toBe('42');
    expect(f.tg.sendMessage.mock.calls.at(-1)?.[1]).toBe('Enter the bottom offset in pixels. Default: 128 px. Higher values move the headline upward.');
    expect((f.tg.sendMessage.mock.calls.at(-1)?.[2] as any).reply_markup.keyboard[0]).toEqual([{text:'Default (128 px)'}]);
    await f.handle(f.update(4,{text:'Default (128 px)'}));
    expect(f.tg.sendMessage.mock.calls.at(-1)?.[1]).toBe('Send your headline in one message. Use a new line wherever you want a new line in the image. On desktop, use Shift+Enter to insert a line break without sending the message.');
    const headline='CHELSEA REPORTEDLY TARGET\nALEX SCOTT FOR JANUARY';
    await f.handle(f.update(5,{text:headline}));expect(f.render).not.toHaveBeenCalled();
    await f.handle(f.update(6,{text:'No'}));
    expect(f.render).toHaveBeenCalledOnce();expect((f.render.mock.calls[0][0] as any).editorial).toMatchObject({template:'large-headline',layoutMode:'manual',bottomOffset:128,headline});
    expect(f.tg.sendDocument).toHaveBeenCalledOnce();expect(f.settings.pending.stage).toBe('delivered');
  });
  it('restores Manual headline entry and allows an offset correction after an unsafe fit',async()=>{
    const f=fixture();f.render.mockRejectedValueOnce(Object.assign(new Error('unsafe manual fit'),{code:'NEWS_MANUAL_LAYOUT_UNSAFE'}));
    await f.handle(f.update(1,photo));await f.handle(f.update(2,{text:'Large Headline'}));await f.handle(f.update(3,{text:'Manual'}));
    await f.handle(f.update(4,{text:'128px'}));await f.handle(f.update(5,{text:'FIRST LINE\nSECOND LINE'}));await f.handle(f.update(6,{text:'No'}));
    expect(f.settings.pending).toMatchObject({stage:'editorial',template:'large-headline',layoutMode:'manual',step:'fit',bottomOffset:128,headline:'FIRST LINE\nSECOND LINE'});
    expect(String(f.tg.sendMessage.mock.calls.at(-1)?.[1])).toContain('Change the headline or offset');
    expect((f.tg.sendMessage.mock.calls.at(-1)?.[2] as any).reply_markup.keyboard[0]).toEqual([{text:'Change headline'},{text:'Change offset'}]);
    await f.handle(f.update(7,{text:'Change offset'}));await f.handle(f.update(8,{text:'160 px'}));
    expect(f.settings.pending).toMatchObject({stage:'branding',job:{editorial:{template:'large-headline',layoutMode:'manual',bottomOffset:160,headline:'FIRST LINE\nSECOND LINE'}}});
    await f.handle(f.update(9,{text:'No'}));
    expect(f.render).toHaveBeenCalledTimes(2);expect((f.render.mock.calls[1][0] as any).editorial.bottomOffset).toBe(160);expect(f.tg.sendDocument).toHaveBeenCalledOnce();
  });
  it('renders once, applies saved styling, sends a JPG document, and needs no /start per post',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));
    const text=f.update(2,{text:'Author | News'});await f.handle(text);await f.handle(text);await f.handle(f.update(3,{text:'No'}));
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0]).toEqual([expect.objectContaining({layout:'single',style:expect.objectContaining({accent:f.config.accent,textSize:80})}),expect.any(Buffer),null]);
    expect(f.tg.sendDocument).toHaveBeenCalledExactlyOnceWith('42','/fake/news.png','','news-post.png');
    expect(f.settings.pending.stage).toBe('delivered');
    await f.handle(f.update(4,photo));await f.handle(f.update(5,{text:'Next | Story'}));await f.handle(f.update(6,{text:'Yes'}));expect(f.render).toHaveBeenCalledTimes(2);
  });
  it('rejects another private chat before downloading or rendering',async()=>{
    const f=fixture();await f.handle(f.update(1,photo,99));expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendDocument).not.toHaveBeenCalled();
  });
  it('accepts and consumes a valid unexpired single-use linking code',async()=>{
    const f=fixture(false);const code='a'.repeat(48);f.settings.linkCodeHash=createHash('sha256').update(code).digest('hex');f.settings.linkExpiresAt=new Date(now+60_000);
    await f.handle(f.update(1,{text:'/start '+code}));expect(f.settings.telegramChatId).toBe('42');expect(f.settings.linkCodeHash).toBeNull();expect(f.render).not.toHaveBeenCalled();
  });
  it('rejects an expired linking code',async()=>{
    const f=fixture(false);const code='a'.repeat(48);f.settings.linkCodeHash=createHash('sha256').update(code).digest('hex');f.settings.linkExpiresAt=new Date(now-1);
    await f.handle(f.update(1,{text:'/start '+code}));expect(f.settings.telegramChatId).toBeNull();
  });
  it('does not retry or send contradictory messages after renderer authentication fails',async()=>{
    const f=fixture();f.render.mockRejectedValueOnce(Object.assign(new Error('hidden'),{code:'NEWS_RENDER_AUTH'}));await f.handle(f.update(1,photo));
    const request=f.update(2,{text:'Author | News'});await f.handle(request);await f.handle(request);await f.handle(f.update(3,{text:'No'}));
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(f.tg.sendMessage).toHaveBeenCalledTimes(2);expect(f.diagnostic).toHaveBeenCalledWith({code:'NEWS_RENDER_AUTH',phase:'render',updateId:3});
  });
  it('blocks polling when a webhook exists without changing it',async()=>{
    const api=vi.fn(async(method:string)=>({ok:true,result:method==='getWebhookInfo'?{url:'https://example.test/webhook'}:{id:1}}));
    expect(await inspectNewsTelegram({api})).toEqual({ok:false,code:'NEWS_TELEGRAM_WEBHOOK'});expect(api.mock.calls.map(c=>c[0])).toEqual(['getMe','getWebhookInfo']);
  });
});
