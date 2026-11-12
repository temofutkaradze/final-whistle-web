// Telegram bots.
// Run with:  npm run bot      (keep this window open)
// Long polling: no public URL / ngrok needed.
//
// Every customer has their OWN bot (token saved on the dashboard, stored encrypted). There is no shared bot.
// That bot belongs to one customer: private Telegram pairing requires explicit website approval.
// Legacy chat IDs alone never authorize access. New / removed customer bots are picked up automatically every 10 seconds.
//
// Commands:  /matches  today's matches     type a team name -> search     send an image -> background
// IMPORTANT: a bot that has a webhook (like the one n8n uses) cannot be polled; use new bots.

import {approvedMatchUser,createMatchAccessHandler} from "./lib/match-pairing.mjs";
import { prisma } from "./lib/db.mjs";
import {acquireProcessLock,processLockClient,PROCESS_LOCKS} from "./lib/process-lock.mjs";
import {updateCursor} from "./lib/update-cursor.mjs";
let stopping=false,managerLock;
const stop=()=>{stopping=true;for(const entry of running.values())entry.stop=true;};
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,stop);
import { makeTelegram, matchImageUpload } from "./lib/telegram.mjs";
import { decryptSecret } from "./lib/crypto.mjs";
import { BACKGROUND_DIR, renderPost, brandLookFields } from "./lib/render.mjs";
import {regenerateAssignedMatches} from './lib/manual-match-post.mjs';
import { ensureDay, formatKickoff, localDayRange } from "./lib/football.mjs";
import { listAvailableMatches, filterMatchList } from "./lib/match-list.mjs";
import { MAX_AGE_HOURS } from "./lib/config.mjs";
import { runPoller, shouldRestart } from "./lib/poller.mjs";
import { toggleSelection } from "./lib/selection.mjs";
import {withBackgroundFile,assignPendingBackground} from "./lib/background-files.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_BUTTONS = 50;

const HELP =
  "How it works:\n" +
  "1. /matches shows today's matches plus cached kickoffs from the last 4 hours. Tap the ones you want a post for.\n" +
  "2. Send a background image (best as a file, so it is not compressed).\n" +
  "3. An observed live 90+ checkpoint may arrive first; the Full Time post follows automatically.\n\n" +
  "Tip: type a team name (e.g. Barcelona) to search today's matches.";

const matchButton = (m, selected) => [
  {
    text: `${selected ? "✅" : "⚽"} ${formatKickoff(m.kickoff)}  ${m.homeTeam} - ${m.awayTeam}`,
    callback_data: `select:${m.fixtureId}`,
  },
];

// ctx = { tg, ownerId }   ownerId = the customer who owns this bot.

async function findUser(ctx, chatId) {
  return approvedMatchUser(prisma,ctx.ownerId,{botId:ctx.botId,connectionToken:ctx.connectionToken,identity:{chatId,telegramUserId:chatId}});
}

async function selectedIds(userId, fixtureIds) {
  const rows = await prisma.selection.findMany({ where: { userId, fixtureId: { in: fixtureIds },status:{not:'DESELECTED'} }, select: { fixtureId: true } });
  return new Set(rows.map((r) => r.fixtureId));
}

async function todaysMatches() {
  return listAvailableMatches({ prisma, ensureDay, localDayRange });
}

// What the customer follows: leagues and/or clubs. Nothing chosen = show every league we store.
async function userFilters(userId) {
  const subs = await prisma.subscription.findMany({ where: { userId, status: "ACTIVE" }, select: { leagueIds: true } });
  const favs = await prisma.favoriteTeam.findMany({ where: { userId }, select: { teamId: true } });
  return { leagues: new Set(subs.flatMap((s) => s.leagueIds)), teams: new Set(favs.map((f) => f.teamId)) };
}

async function sendMatchList(ctx, chatId, user, search) {
  const { tg } = ctx;
  let matches;
  try {
    matches = await todaysMatches();
  } catch (e) {
    console.error("loading matches failed:", e.message);
    await tg.sendMessage(chatId, "Could not load today's matches right now. Please try again in a few minutes.");
    return;
  }
  const { leagues, teams } = await userFilters(user.id);
  matches = filterMatchList(matches, { leagues, teams }, search, MAX_BUTTONS);

  if (!matches.length) {
    await tg.sendMessage(
      chatId,
      search ? "Nothing found for that name. Try another word, or send /matches again." : "No matches in your leagues today.",
    );
    return;
  }
  if(!await findUser(ctx,chatId))return;
  const chosen = await selectedIds(user.id, matches.map((m) => m.fixtureId));
  await tg.sendMessage(chatId, search ? "Found:" : "Pick the matches you want a post for (tap again to remove).", {
    reply_markup: { inline_keyboard: matches.map((m) => matchButton(m, chosen.has(m.fixtureId))) },
  });
}

async function handleStart(ctx, chatId) {
  await ctx.tg.sendMessage(chatId, HELP);
}

// A background image arrived (photo or image file).
async function handleUpload(ctx, msg, chatId) {
  const { tg } = ctx;
  const user = await findUser(ctx, chatId);
  if (!user) return handleStart(ctx, chatId);

  let upload;
  try{upload=matchImageUpload(msg);}
  catch(e){await tg.sendMessage(chatId,e.message);return;}

  const open = await prisma.selection.findMany({
    where: {
      userId: user.id,
      status: { not: "DESELECTED" },
    },
    include: { match: true },
    orderBy: { createdAt: "asc" },
  });
  if (!open.length) {
    await tg.sendMessage(chatId, "No matches selected. Please select a match first.");
    return;
  }

  let file;
  try {
    file = await tg.downloadTelegramFile(upload.fileId, BACKGROUND_DIR, `${user.id}_${Date.now()}`, {imageExtension:upload.extension});
  } catch (e) {
    await tg.sendMessage(chatId, `Could not use that image: ${e.message}`);
    return;
  }

  if(!await findUser(ctx,chatId))return;
  await withBackgroundFile(prisma,file,(tx,resolved)=>tx.user.update({ where: { id: user.id }, data: { pendingBackgroundPath: resolved } }));
  const buttons = open.map((s) => [{ text: `⚽ ${s.match.homeTeam} - ${s.match.awayTeam}`, callback_data: `bg:${s.fixtureId}` }]);
  buttons.push([{ text: "All my selected matches", callback_data: "bg:all" }]);
  await tg.sendMessage(chatId, "Which match is this background for?", { reply_markup: { inline_keyboard: buttons } });
}

async function handleCallback(ctx, cb) {
  const { tg } = ctx;
  const chatId = String(cb.message?.chat?.id ?? "");
  const user = await findUser(ctx, chatId);
  const answer = (text) => tg.api("answerCallbackQuery", { callback_query_id: cb.id, text });
  if (!user) return answer("Please connect your account first.");

  const [kind, arg] = String(cb.data ?? "").split(":");

  if (kind === "select") {
    const fixtureId = Number(arg);
    const { result } = await toggleSelection({ prisma, userId: user.id, fixtureId, maxAgeHours: MAX_AGE_HOURS });
    if (result === "no-match") return answer("This match is no longer available.");
    if (result === "already-sent") return answer("Already sent to you.");
    if (result === "sending") return answer("This post is being sent right now.");
    if (result === "too-old") return answer("This match is too old.");
    const nowSelected = result === "selected";
    await answer(nowSelected ? "Selected ✅" : "Removed");

    // Update the tick marks in the message that was tapped.
    const kb = cb.message?.reply_markup?.inline_keyboard;
    if (kb) {
      const updated = kb.map((row) =>
        row.map((b) => {
          if (b.callback_data !== cb.data) return b;
          const clean = b.text.replace(/^(✅|⚽)\s*/, "");
          return { ...b, text: `${nowSelected ? "✅" : "⚽"} ${clean}` };
        }),
      );
      await tg.api("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: updated },
      });
    }
    return;
  }

  if (kind === "bg") {
    const path = user.pendingBackgroundPath;
    if (!path) return answer("Please send the image again.");
    const res = await assignPendingBackground(prisma,user.id,path,arg === "all" ? "all" : Number(arg));
    await answer(res.count ? "Background saved ✅" : "No matching selection.");
    await tg.api("editMessageText", {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: res.count ? `Background saved for ${res.count} match(es). ✅` : "No matching selection.",
    });
    if(res.count){
      const result=await regenerateAssignedMatches({prisma,userId:user.id,backgroundPath:path,fixtureId:arg==='all'?'all':Number(arg),
        scope:{botId:ctx.botId,connectionToken:ctx.connectionToken,identity:{chatId,telegramUserId:chatId}},tg,renderPost,brandLookFields,
        isActive:()=>!stopping&&Boolean(managerLock?.active())});
      if(result.unavailable)await tg.sendMessage(chatId,'Background saved. A result image cannot be generated until the selected match has a recorded score.');
      if(result.failed)await tg.sendMessage(chatId,'Background saved, but the new image could not be delivered. Upload another photo to try again.');
    }
    return;
  }

  await answer("Unknown action.");
}

async function handleAuthorized(ctx, update) {
  if (update.callback_query) return handleCallback(ctx, update.callback_query);

  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);

  if (msg.photo || msg.document) return handleUpload(ctx, msg, chatId);
  if (typeof msg.text !== "string") return;

  const text = msg.text.trim();
  const start = text.match(/^\/start(?:\s+(\S+))?$/);
  if (start) return handleStart(ctx, chatId);

  const user = await findUser(ctx, chatId);
  if (!user) return handleStart(ctx, chatId);

  if (/^\/matches\b/i.test(text)) return sendMatchList(ctx, chatId, user, null);
  if (text.startsWith("/")) return ctx.tg.sendMessage(chatId, HELP);
  return sendMatchList(ctx, chatId, user, text.toLowerCase());
}

const handle = createMatchAccessHandler({prisma,onAuthorized:handleAuthorized});

// Something went wrong while handling a message or a tap: tell the person briefly instead of staying silent.
async function tellProblem(ctx, update) {
  if (update.callback_query) await ctx.tg.api("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Something went wrong. Please try again." });
  else if (update.message?.chat) await ctx.tg.sendMessage(String(update.message.chat.id), "Something went wrong. Please try again in a moment.");
}

// One long-polling loop per bot (the loop itself is in lib/poller.mjs).
const pollLoop = (entry) => runPoller(entry, { handle, onUpdateError: tellProblem, sleep });

const running = new Map(); // token -> { stop, ctx, tg, label }

async function syncBots() {
  const wanted = new Map(); // token -> { ownerId, label }

  const owners = await prisma.user.findMany({ where: { botToken: { not: null } }, select: { id: true, email: true, botToken: true, botId: true } });
  for (const o of owners) {
    try {
      wanted.set(decryptSecret(o.botToken), { ownerId: o.id, label: o.email, botId:o.botId, connectionToken:o.botToken });
    } catch (e) {
      console.error(`[${o.email}] cannot read the saved bot token: ${e.message}`);
    }
  }

  for (const [token, info] of wanted) {
    const existing = running.get(token);
    if (!shouldRestart(existing, Date.now())) continue; // running, or failed a moment ago and waiting before the next try
    if (existing) existing.stop = true;
    const tg = makeTelegram(token);
    if(stopping || !managerLock?.active()) return;
    const cursor=await updateCursor(info.ownerId,info.botId);
    const entry = { stop: false, failed: false, tg, label: info.label, ctx: { tg, ownerId: info.ownerId, botId:info.botId, connectionToken:info.connectionToken }, lastFailure: existing?.lastFailure ?? null, ...cursor, isActive:()=>!stopping&&Boolean(managerLock?.active()) };
    running.set(token, entry);
    entry.task=pollLoop(entry).catch((e) => {
      console.error(`[${info.label}] polling crashed:`, e);
      entry.failed = true; // the next round restarts it (a crash used to end this bot until the program was restarted)
      entry.retryAt = Date.now() + 30_000;
    });
  }
  for (const [token, entry] of running) {
    if (!wanted.has(token)) {
      entry.stop = true;
      running.delete(token);
    }
  }
}

async function main() {
  managerLock=await acquireProcessLock(processLockClient("final-whistle-match-manager-v3"),{key:PROCESS_LOCKS.matchBot,codePrefix:"MATCH_MANAGER",onLost:detail=>{console.error("[Match] MATCH_MANAGER_LOCK_LOST",JSON.stringify(detail));stop();}});
  if(!managerLock){console.error("[Match] MATCH_MANAGER_ALREADY_RUNNING; no second poller started.");return;}
  console.log("Bot manager started. (Ctrl+C to stop)");
  while (!stopping && managerLock.active()) {
    try {
      await syncBots();
    } catch (e) {
      console.error("syncBots failed:", e.message);
    }
    await sleep(10000);
  }
}

main().catch(()=>{console.error("[Match] MATCH_MANAGER_STOPPED; check the database and local cursor storage.");process.exitCode=1;}).finally(async()=>{stop();await Promise.allSettled([...running.values()].map(entry=>entry.task));await managerLock?.release();await prisma.$disconnect();});
