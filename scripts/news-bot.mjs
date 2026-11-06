import {retireCooldowns} from './lib/idle-cache.mjs';
﻿// One News manager per database. No webhook, bot command or live n8n mutation.
import { prisma } from './lib/db.mjs';
import { decryptSecret } from './lib/crypto.mjs';
import { makeTelegram } from './lib/telegram.mjs';
import { createNewsHandler } from './lib/news-core.mjs';
import { acquireNewsManagerLock } from './lib/news-manager-lock.mjs';
import { inspectNewsTelegram, telegramPollingCode } from './lib/news-preflight.mjs';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {processLockClient} from './lib/process-lock.mjs';
import { renderNewsPost, verifyNewsRenderer } from '../src/lib/news/render.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const running=new Map();
const blockedUntil=new Map();
let stopping=false;
let managerLock;
const stop=()=>{stopping=true;for(const ctx of running.values())ctx.stop=true;};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);

function start(owner){
  const tg=makeTelegram(decryptSecret(owner.botToken));
  const ctx={stop:false,connectionToken:owner.botToken,task:null};
  const handle=createNewsHandler({prisma,tg,ownerId:owner.userId,connectionToken:owner.botToken,
    isActive:()=>!stopping&&!ctx.stop&&Boolean(managerLock?.active()),
    download:async id=>{
      const file=await tg.downloadTelegramFile(id,path.join(root,'storage','news-tmp'),`news-${randomUUID()}`);
      try{
        const buffer=await readFile(file);
        const meta=await sharp(buffer,{limitInputPixels:25_000_000}).metadata();
        if(!['jpeg','png','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>8000||meta.height>8000)throw new Error('Invalid image');
        return buffer;
      }finally{await unlink(file).catch(()=>{});}
    },render:renderNewsPost,cleanup:unlink,
  });
  ctx.task=(async()=>{
    const preflight=await inspectNewsTelegram(tg);
    if(!preflight.ok){console.error(`[News] ${preflight.code}; polling was not started. No webhook was changed.`);blockedUntil.set(owner.userId,Date.now()+300_000);return;}
    while(!ctx.stop&&!stopping){
      try{
        const current=await prisma.newsSettings.findUnique({where:{userId:owner.userId},select:{lastUpdateId:true,botToken:true}});
        if(current?.botToken!==owner.botToken)break;
        const result=await tg.api('getUpdates',{offset:current.lastUpdateId==null?0:current.lastUpdateId+1,timeout:25,allowed_updates:['message']},{timeoutMs:40_000});
        if(!result.ok){
          console.error(`[News] ${telegramPollingCode(result)}; check the dedicated bot token, existing webhook or other pollers. No webhook was changed.`);
          blockedUntil.set(owner.userId,Date.now()+(result.error_code===401?300_000:60_000));break;
        }
        for(const update of result.result??[]){if(ctx.stop||stopping)break;await handle(update);}
      }catch{if(!ctx.stop&&!stopping){console.error('[News] NEWS_POLLING_FAILED; check the database and network.');await wait(5000);}}
    }
  })().finally(()=>{if(running.get(owner.userId)===ctx)running.delete(owner.userId);});
  return ctx;
}

async function main(){
  const client=processLockClient('final-whistle-news-manager-v3');
  managerLock=await acquireNewsManagerLock(client,{onLost:detail=>{console.error('[News] NEWS_MANAGER_LOCK_LOST; stopping this manager.',JSON.stringify(detail));stop();}});
  if(!managerLock){console.error('[News] NEWS_MANAGER_ALREADY_RUNNING; another manager owns this database. No second poller was started.');return;}
  try{
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
    stop();await Promise.allSettled([...running.values()].map(ctx=>ctx.task));await managerLock.release();
  }
}
main().catch(error=>{
  const code=['NEWS_RENDER_AUTH','NEWS_RENDER_PROTOCOL','NEWS_RENDER_UNAVAILABLE','NEWS_MANAGER_LOCK_LOST','NEWS_MANAGER_DATABASE'].includes(error?.code)?error.code:'NEWS_STARTUP_FAILED';
  console.error(`[News] ${code}; restart the current renderer and News bot using the same local configuration. This manager stopped; failed updates are not retried automatically.`);
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
