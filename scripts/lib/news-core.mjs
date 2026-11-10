import { standingsTransition, createStandingsService, StandingsError, UCL_ROW_HELP } from '../../src/lib/news/standings.ts';
import { createHash } from 'node:crypto';
import { DEFAULT_NEWS_STYLE, HELP } from '../../src/lib/news/parse.ts';
import { originalNewsTransition } from '../../src/lib/news/conversation.ts';

export const NEWS_HELP = HELP+'\n\nStandings: send a photo caption such as Premier League 15 16 17 18, or /standings to collect messages.\n'+UCL_ROW_HELP;
export const builtinNewsTemplates = ['single','left','right','breaking'].map(id=>({id,layout:id,config:DEFAULT_NEWS_STYLE,name:({single:'Single',left:'Circle Left',right:'Circle Right',breaking:'BREAKING'})[id]}));
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeCodes=new Set(['NEWS_RENDER_AUTH','NEWS_RENDER_PROTOCOL','NEWS_RENDER_UNAVAILABLE','NEWS_RENDER_FAILED','NEWS_RENDER_OUTPUT']);

// Security/linking and durable deduplication wrap the original conversation.
// Standings is opt-in; original News behavior and at-most-once delivery remain unchanged.
export function createNewsHandler({prisma,tg,ownerId,connectionToken,download,render,cleanup,standings=createStandingsService(null),now=Date.now,isActive=()=>true,onDiagnostic=event=>console.error(`[News] ${event.code}; phase=${event.phase}; update=${event.updateId}`)}){
  const table=prisma.newsSettings;
  return async function processUpdate(update){
    if(!Number.isSafeInteger(update.update_id)||!isActive())return;
    const settings=await table.findUnique({where:{userId:ownerId}});
    if(!settings?.botToken||(connectionToken&&settings.botToken!==connectionToken))return;
    const claim=await table.updateMany({where:{userId:ownerId,botToken:settings.botToken,OR:[{lastUpdateId:null},{lastUpdateId:{lt:update.update_id}}]},data:{lastUpdateId:update.update_id}});
    if(!claim.count)return;
    const msg=update.message;
    if(!msg||msg.chat?.type!=='private')return;
    const chatId=String(msg.chat.id);
    if(String(msg.from?.id??'')!==chatId)return;
    const reply=async text=>{
      const response=await tg.sendMessage(chatId,text);
      if(response?.ok===false)throw new Error('TELEGRAM_REPLY_FAILED');
    };
    const start=(msg.text??'').trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
    if(settings.telegramChatId!==chatId){
      const code=start?.[1];
      if(code&&/^[a-f0-9]{48}$/.test(code)){
        const linked=await table.updateMany({where:{userId:ownerId,botToken:settings.botToken,telegramChatId:null,linkCodeHash:hash(code),linkExpiresAt:{gt:new Date(now())}},data:{telegramChatId:chatId,linkCodeHash:null,linkExpiresAt:null,pending:null}});
        if(linked.count){await reply(NEWS_HELP);return;}
      }
      await reply('This bot is private. Use the account linking button on your Final Whistle News dashboard.');return;
    }
    if(/^\/(help|start)(?:@\w+)?$/i.test((msg.text??'').trim())){await reply(NEWS_HELP);return;}
    let phase='parse';
    let output;
    let delivered=false;
    try{
      const raw=settings.pending;
      // Read old sessions safely, but do not resume any old caption-driven job.
      const pending=raw&&typeof raw==='object'&&!Array.isArray(raw)&&raw.background&&(!raw.stage||raw.stage==='collecting')?{background:raw.background,circle:raw.circle??null,ts:raw.ts}:null;
      let config;
      if(!builtinNewsTemplates.some(t=>t.id===settings.defaultTemplateRef)){
        const template=await prisma.newsTemplate.findFirst({where:{id:settings.defaultTemplateRef,userId:ownerId},select:{config:true}});
        config=template?.config;
      }
      let transition=standingsTransition(msg,raw,now())??originalNewsTransition(msg,pending,now(),config);
      if('request' in transition){
        // Resolve before downloading; disabled sources never process the user's photo.
        try{transition={pending:null,background:transition.background,circle:null,job:await standings(transition.request.leagueId,transition.request.positions)};}
        catch(error){if(error instanceof StandingsError){await reply(error.message);return;}throw error;}
      }
      const state='job' in transition?{stage:'rendering',requestId:update.update_id}:transition.pending??{};
      const saved=await table.updateMany({where:{userId:ownerId,botToken:settings.botToken,telegramChatId:chatId},data:{pending:state}});
      if(!saved.count||!isActive())return;
      if('reply' in transition){phase='reply';await reply(transition.reply);return;}
      // As in n8n, consume images BEFORE downloads/render. A second text message
      // consequently asks for a new background rather than regenerating this job.
      phase='download';
      const background=await download(transition.background);
      const circle=transition.circle?await download(transition.circle):null;
      if(!isActive())return;
      phase='render';output=await render(transition.job,background,circle);
      if(!isActive())return;
      // Recheck that a disconnect/reconnect did not revoke this worker mid-render.
      const active=await table.updateMany({where:{userId:ownerId,botToken:settings.botToken,telegramChatId:chatId},data:{pending:{stage:'sending',requestId:update.update_id}}});
      if(!active.count||!isActive())return;
      phase='send';
      await tg.sendDocument(chatId,output,transition.job.caption.slice(0,1000),'news-post.jpg');
      delivered=true;
      phase='commit';
      await table.updateMany({where:{userId:ownerId,botToken:settings.botToken,telegramChatId:chatId},data:{pending:{stage:'delivered',requestId:update.update_id}}});
    }catch(error){
      // The original graph has no Telegram error branch. Keep failures out of the
      // chat and expose a classified operator diagnostic, never raw credentials.
      const code=delivered?'NEWS_DELIVERED_STATE_FAILED':safeCodes.has(error?.code)?error.code:error?.telegramCode===401?'NEWS_TELEGRAM_AUTH':phase==='send'?(Number.isInteger(error?.telegramCode)?'NEWS_TELEGRAM_SEND_REJECTED':'NEWS_DELIVERY_UNCERTAIN'):`NEWS_${phase.toUpperCase()}_FAILED`;
      onDiagnostic({code,phase,updateId:update.update_id});
    }finally{if(output)await cleanup(output).catch(()=>{});}
  };
}
