import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { originalNewsTransition, BACKGROUND_SAVED, CIRCLE_SAVED } from '@/lib/news/conversation';
import { buildOriginalJob, DEFAULT_NEWS_STYLE } from '@/lib/news/parse';
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
  const tg={sendMessage:vi.fn(async()=>({ok:true})),sendDocument:vi.fn(async()=>{})};
  const render=vi.fn(async(..._args:unknown[])=>'/fake/news.jpg');
  const diagnostic=vi.fn();
  const handle=createNewsHandler({prisma:{newsSettings:table,newsTemplate:{findFirst:vi.fn(async()=>({config}))}},tg,ownerId:'owner',connectionToken:settings.botToken,download:vi.fn(async()=>Buffer.from('image')),render,cleanup:vi.fn(async()=>{}),now:()=>now,onDiagnostic:diagnostic});
  const update=(id:number,message:Record<string,unknown>,chat=42)=>({update_id:id,message:{chat:{id:chat,type:'private'},from:{id:chat},...message}});
  return {settings,tg,render,diagnostic,handle,update,config};
}

describe('News original conversation',()=>{
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

describe('News bot integration with mocked Telegram and persistence',()=>{
  for(const label of ['Headline + Subtitle','Large Headline','NEWS (Red)','DID YOU KNOW (Yellow)'])it('adds '+label+' without replacing the legacy conversation',async()=>{
    const f=fixture();await f.handle(f.update(1,{document:{file_id:'full-quality-background',file_name:'photo.webp',mime_type:'application/octet-stream'}}));
    expect(f.tg.sendMessage.mock.calls[0]).toMatchObject(['42',expect.any(String),{reply_markup:{keyboard:expect.arrayContaining([[{text:label}]]),resize_keyboard:true,one_time_keyboard:true}}]);
    await f.handle(f.update(2,{text:label}));expect(f.settings.pending.step).toBe('headline');
    await f.handle(f.update(3,{text:'THE *NEXT\nCHAPTER*'}));
    if(label==='Headline + Subtitle'){expect(f.render).not.toHaveBeenCalled();await f.handle(f.update(4,{text:'An editable *subtitle*'}));}
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0][0]).toMatchObject({layout:'single',quote:'THE *NEXT\nCHAPTER*',editorial:{headline:'THE *NEXT\nCHAPTER*',subtitle:label==='Headline + Subtitle'?'An editable *subtitle*':''}});
    expect(f.tg.sendDocument).toHaveBeenCalledOnce();expect(f.settings.pending.stage).toBe('delivered');
  });
  it('renders once, applies saved styling, sends a JPG document, and needs no /start per post',async()=>{
    const f=fixture();await f.handle(f.update(1,photo));
    const text=f.update(2,{text:'Author | News'});await f.handle(text);await f.handle(text);
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0]).toEqual([expect.objectContaining({layout:'single',style:expect.objectContaining({accent:f.config.accent,textSize:80})}),expect.any(Buffer),null]);
    expect(f.tg.sendDocument).toHaveBeenCalledExactlyOnceWith('42','/fake/news.jpg','','news-post.jpg');
    expect(f.settings.pending.stage).toBe('delivered');
    await f.handle(f.update(3,photo));await f.handle(f.update(4,{text:'Next | Story'}));expect(f.render).toHaveBeenCalledTimes(2);
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
    const request=f.update(2,{text:'Author | News'});await f.handle(request);await f.handle(request);
    expect(f.render).toHaveBeenCalledTimes(1);expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(f.tg.sendMessage).toHaveBeenCalledTimes(1);expect(f.diagnostic).toHaveBeenCalledWith({code:'NEWS_RENDER_AUTH',phase:'render',updateId:2});
  });
  it('blocks polling when a webhook exists without changing it',async()=>{
    const api=vi.fn(async(method:string)=>({ok:true,result:method==='getWebhookInfo'?{url:'https://example.test/webhook'}:{id:1}}));
    expect(await inspectNewsTelegram({api})).toEqual({ok:false,code:'NEWS_TELEGRAM_WEBHOOK'});expect(api.mock.calls.map(c=>c[0])).toEqual(['getMe','getWebhookInfo']);
  });
});
