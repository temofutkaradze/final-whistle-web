import './lib/runtime-security-bootstrap.mjs';
import {createJobScheduler,createReplyBudget} from './lib/job-scheduler.mjs';
import {createOrderedUpdateCursor} from './lib/ordered-update-cursor.mjs';
import {privateMatchIdentity} from './lib/match-pairing.mjs';
import logging from './lib/security-log.cjs';
logging.install();
import {retireCooldowns} from './lib/idle-cache.mjs';
﻿// One News manager per database. No webhook, bot command or live n8n mutation.
import { prisma } from './lib/db.mjs';
import { decryptSecret } from './lib/crypto.mjs';
import { makeTelegram } from './lib/telegram.mjs';
import { createNewsMemberRouter } from './lib/news-member-router.mjs';
import { createFootballDataProvider } from '../src/lib/news/football-data.ts';
import { createStandingsService } from '../src/lib/news/standings.ts';
import { acquireNewsManagerLock } from './lib/news-manager-lock.mjs';
import { inspectNewsTelegram, telegramPollingCode } from './lib/news-preflight.mjs';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {processLockClient} from './lib/process-lock.mjs';
import {runTemporaryDirectoryMaintenance} from './lib/storage-maintenance.mjs';
import { renderNewsPost, verifyNewsRenderer } from '../src/lib/news/render.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// One shared cache and rate budget for every account handled by this manager.
const standings=createStandingsService(createFootballDataProvider({apiKey:process.env.FOOTBALL_DATA_API_KEY}));
const running=new Map();
const jobs=createJobScheduler(),busyReplies=createReplyBudget();
const blockedUntil=new Map();
let stopping=false;
let managerLock;
const stop=()=>{stopping=true;for(const ctx of running.values())ctx.stop=true;};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);

function start(owner){
  const tg=makeTelegram(decryptSecret(owner.botToken));
  const ctx={stop:false,connectionToken:owner.botToken,task:null};
  let updateCursor=null;
  const inFlight=new Set();
  const handle=createNewsMemberRouter({prisma,tg,standings,ownerId:owner.userId,connectionToken:owner.botToken,
    isActive:()=>!stopping&&!ctx.stop&&Boolean(managerLock?.active()),
    download:async id=>{
      const file=await tg.downloadTelegramFile(id,path.join(root,'storage','news-tmp'),`news-${randomUUID()}`);
      try{
        const buffer=await readFile(file);
        const meta=await sharp(buffer,{limitInputPixels:25_000_000}).metadata();
        if(!['jpeg','png','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>8000||meta.height>8000)throw new Error('Invalid image');
        return buffer;
      }finally{await unlink(file).catch(()=>{});}
    },render:renderNewsPost,cleanup:unlink,manageCursorExternally:true,
  });
  ctx.task=(async()=>{
    const preflight=await inspectNewsTelegram(tg);
    if(!preflight.ok){console.error(`[News] ${preflight.code}; polling was not started. No webhook was changed.`);blockedUntil.set(owner.userId,Date.now()+300_000);return;}
    while(!ctx.stop&&!stopping){
      try{
        const current=await prisma.newsSettings.findUnique({where:{userId:owner.userId},select:{lastUpdateId:true,botToken:true,telegramChatId:true}});
        if(current?.botToken!==owner.botToken)break;
        if(!updateCursor)updateCursor=createOrderedUpdateCursor(current.lastUpdateId==null?0:current.lastUpdateId+1,async next=>{
          const saved=await prisma.newsSettings.updateMany({where:{userId:owner.userId,botToken:owner.botToken,OR:[{lastUpdateId:null},{lastUpdateId:{lt:next-1}}]},data:{lastUpdateId:next-1}});
          if(!saved.count){const latest=await prisma.newsSettings.findUnique({where:{userId:owner.userId},select:{lastUpdateId:true,botToken:true}});if(latest?.botToken!==owner.botToken||(latest.lastUpdateId??-1)<next-1)throw Error('NEWS_UPDATE_CURSOR_FAILED');}
        });
        try{await updateCursor.retry();}catch{console.error('[News] NEWS_UPDATE_CURSOR_FAILED; pending work remains recoverable.');await wait(1000);continue;}
        const result=await tg.api('getUpdates',{offset:updateCursor.checkpointOffset,timeout:25,allowed_updates:['message']},{timeoutMs:40_000});
        if(!result.ok){
          console.error(`[News] ${telegramPollingCode(result)}; check the dedicated bot token, existing webhook or other pollers. No webhook was changed.`);
          blockedUntil.set(owner.userId,Date.now()+(result.error_code===401?300_000:60_000));break;
        }
        for(const update of result.result??[]){
          if(ctx.stop||stopping)break;
          if(!Number.isSafeInteger(update.update_id)||update.update_id<updateCursor.fetchOffset)continue;
          const identity=privateMatchIdentity(update.message);
          let ticketComplete,releaseTicket,processed=false;
          const ticketReady=new Promise(resolve=>{releaseTicket=resolve;});
          const work=jobs.enqueue(owner.userId+':'+(identity?.telegramUserId??'invalid'),current.telegramChatId===identity?.chatId,async()=>{
            if(ctx.stop||stopping||!managerLock?.active())throw Object.assign(Error('Scheduled Telegram work was interrupted'),{code:'TELEGRAM_WORK_INTERRUPTED'});
            await handle(update);
            processed=true;await ticketReady;await ticketComplete();
          });
          if(!work&&identity&&busyReplies(owner.userId+':'+identity.chatId))tg.sendMessage(identity.chatId,'Your request queue is full. Please wait, then resend this request.').catch(()=>{});
          if(!work){await wait(500);break;}
          const ticket=updateCursor.accept(update.update_id);if(!ticket)continue;
          ticketComplete=ticket.complete;releaseTicket();
          const settled=work.catch(async error=>{
            if(!processed&&error?.code==='TELEGRAM_WORK_INTERRUPTED')return;
            if(!processed){console.error('[News] NEWS_SCHEDULED_UPDATE_FAILED; will replay from the saved cursor.');ctx.stop=true;blockedUntil.set(owner.userId,Date.now()+60_000);return;}
            console.error('[News] NEWS_UPDATE_CURSOR_FAILED');
          }).catch(()=>console.error('[News] NEWS_UPDATE_CURSOR_FAILED'));
          inFlight.add(settled);settled.finally(()=>inFlight.delete(settled));
        }
        // Fetch only the persisted completed offset; repeated updates are skipped above.
        // This admits another user's commands during a render without premature acknowledgement.
        if(updateCursor.pending)await wait(1000);
        if(ctx.stop||stopping)break;
      }catch{if(!ctx.stop&&!stopping){console.error('[News] NEWS_POLLING_FAILED; check the database and network.');await wait(5000);}}
    }
  })().finally(async()=>{ctx.stop=true;await Promise.all(inFlight);if(running.get(owner.userId)===ctx)running.delete(owner.userId);});
  return ctx;
}

async function main(){
  const client=processLockClient('final-whistle-news-manager-v3');
  managerLock=await acquireNewsManagerLock(client,{onLost:detail=>{console.error('[News] NEWS_MANAGER_LOCK_LOST; stopping this manager.',JSON.stringify(detail));stop();}});
  if(!managerLock){console.error('[News] NEWS_MANAGER_ALREADY_RUNNING; another manager owns this database. No second poller was started.');return;}
  try{
    try {
      const report=await runTemporaryDirectoryMaintenance({name:'newsTemp',log:message=>console.log(message)});
      if(report.mode==='dry-run'&&report.candidates.length)console.log(`[maintenance dry-run] abandoned News uploads=${report.candidates.length}`);
    } catch { console.error('[News] Temporary-file maintenance report unavailable; uploads were not deleted.'); }
    const deadline=Date.now()+30_000;
    while(true){
      try{await verifyNewsRenderer();break;}
      catch(error){if(error.code!=='NEWS_RENDER_UNAVAILABLE'||Date.now()>=deadline)throw error;await wait(2000);}
    }
    console.log('News bot manager started: original conversation, renderer protocol 2.');
    while(!stopping){
      await managerLock.heartbeat();
      try{
        const owners=await prisma.newsSettings.findMany({where:{botToken:{not:null}},select:{userId:true,botToken:true}});
        const wanted=new Map(owners.map(o=>[o.userId,o]));
        retireCooldowns(blockedUntil,wanted);
        for(const [id,ctx] of running)if(wanted.get(id)?.botToken!==ctx.connectionToken)ctx.stop=true;
        for(const owner of owners)if(!running.has(owner.userId)&&(blockedUntil.get(owner.userId)??0)<=Date.now()){
          try{running.set(owner.userId,start(owner));}catch{console.error('[News] NEWS_TOKEN_DECRYPT_FAILED; verify the existing local encryption configuration.');blockedUntil.set(owner.userId,Date.now()+300_000);}
        }
      }catch{console.error('[News] NEWS_SETTINGS_UNAVAILABLE; check the database configuration.');}
      await wait(10_000);
    }
  }finally{
    stop();await Promise.allSettled([...running.values()].map(ctx=>ctx.task));await jobs.close();await managerLock.release();
  }
}
main().catch(error=>{
  const code=['NEWS_RENDER_AUTH','NEWS_RENDER_PROTOCOL','NEWS_RENDER_UNAVAILABLE','NEWS_MANAGER_LOCK_LOST','NEWS_MANAGER_DATABASE'].includes(error?.code)?error.code:'NEWS_STARTUP_FAILED';
  console.error(`[News] ${code}; restart the current renderer and News bot using the same local configuration. This manager stopped; failed updates are not retried automatically.`);
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
