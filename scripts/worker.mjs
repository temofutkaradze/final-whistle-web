// Worker: finds finished matches, builds the post for every customer who picked the match,
// and sends it to their Telegram chat.
// Run with:  npm run worker      (keep this window open; the render server must run too)
//
// The logic lives in lib/worker-core.mjs (so it can be tested); this file connects it to the real database,
// the real match data, the render server and Telegram, and runs it once a minute.

import { unlink } from "node:fs/promises";
import { prisma } from "./lib/db.mjs";
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
  // A crash while sending leaves rows in SENDING; put them back in the queue.
  await worker.recoverStuck({ all: true });
  console.log("Worker started. Checking every minute... (Ctrl+C to stop)");

  let lastHousekeeping = 0;
  let lastCleanup = 0;
  while (true) {
    try {
      await worker.tick();
    } catch (e) {
      console.error("[tick failed]", e.message);
    }
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

main();
