// Worker: finds finished matches, builds the post for every customer who picked the match,
// and sends it to their Telegram chat.
// Run with:  npm run worker      (keep this window open; the render server must run too)
//
// The logic lives in lib/worker-core.mjs (so it can be tested); this file connects it to the real database,
// the real match data, the render server and Telegram, and runs it once a minute.

import { unlink } from "node:fs/promises";
import { prisma } from "./lib/db.mjs";
import {acquireProcessLock,processLockClient,PROCESS_LOCKS} from "./lib/process-lock.mjs";
let stopping=false,workerLock;
const stop=()=>{stopping=true;};
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,stop);
import { telegramForUser } from "./lib/telegram.mjs";
import { buildEventsHtml } from "./lib/events.mjs";
import { DEFAULT_BACKGROUND, brandLookFields, downloadBackground, fileExists, renderPost } from "./lib/render.mjs";
import { fetchEvents, isDead, isFinished, localDate, refreshStatuses, saveEvents } from "./lib/football.mjs";
import * as config from "./lib/config.mjs";
import { createWorkerCore } from "./lib/worker-core.mjs";

async function pickBackground(sel, brand) {
  if (sel.backgroundPath && (await fileExists(sel.backgroundPath))) return { background_path: sel.backgroundPath };
  if (brand?.backgroundPath && (await fileExists(brand.backgroundPath))) return { background_path: brand.backgroundPath };
  if (brand?.backgroundUrl) {
    try {
      const p = await downloadBackground(brand.id, brand.backgroundUrl);
      if (p) return { background_path: p };
    } catch (e) {
      console.error("brand background failed:", e.message);
    }
  }
  return { background_data_uri: DEFAULT_BACKGROUND };
}

const worker = createWorkerCore({
  prisma,
  isActive:()=>!stopping&&Boolean(workerLock?.active()),
  football: { refreshStatuses, fetchEvents, saveEvents, isFinished, isDead },
  buildEventsHtml,
  renderPost,
  brandLookFields,
  pickBackground,
  telegramForUser,
  unlink,
  localDate,
  config,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  workerLock=await acquireProcessLock(processLockClient("final-whistle-match-worker-v3"),{key:PROCESS_LOCKS.matchWorker,codePrefix:"MATCH_WORKER",onLost:detail=>{console.error("[Match] MATCH_WORKER_LOCK_LOST",JSON.stringify(detail));stop();}});
  if(!workerLock){console.error("[Match] MATCH_WORKER_ALREADY_RUNNING; no second worker started.");return;}
  // Only stale jobs are recoverable, never another worker's current send.
  await worker.recoverStuck();
  console.log("Worker started. Checking every minute... (Ctrl+C to stop)");

  let lastHousekeeping = 0;
  let lastCleanup = 0;
  while (!stopping && workerLock.active()) {
    try {
      await worker.tick();
    } catch (e) {
      console.error("[tick failed]", e.message);
    }
    if(stopping || !workerLock.active()) break;
    try {
      if (Date.now() - lastHousekeeping > 10 * 60e3) {
        lastHousekeeping = Date.now();
        await worker.recoverStuck();
        await worker.expireOld();
      }
      if (Date.now() - lastCleanup > 3600e3) {
        lastCleanup = Date.now();
        await worker.cleanup();
      }
    } catch (e) {
      console.error("[housekeeping failed]", e.message);
    }
    await sleep(60000);
  }
}

main().catch(()=>{console.error("[Match] MATCH_WORKER_STOPPED; check the database.");process.exitCode=1;}).finally(async()=>{stop();await workerLock?.release();await prisma.$disconnect();});
