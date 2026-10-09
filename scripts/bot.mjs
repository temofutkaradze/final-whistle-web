// Telegram bots.
// Run with:  npm run bot      (keep this window open)
// Long polling: no public URL / ngrok needed.
//
// Two kinds of bots run side by side:
//   - every customer's OWN bot (token saved on the dashboard, stored encrypted). That bot belongs to
//     one customer: the first chat that presses Start is bound to the account, everyone else is refused.
//   - the optional shared demo bot (TELEGRAM_BOT_TOKEN in .env), linked with a code from the dashboard.
// New / removed customer bots are picked up automatically every 30 seconds.
//
// Commands:  /matches  today's matches     type a team name -> search     send an image -> background
// IMPORTANT: a bot that has a webhook (like the one n8n uses) cannot be polled; use new bots.

import { prisma } from "./lib/db.mjs";
import { makeTelegram, sharedToken } from "./lib/telegram.mjs";
import { decryptSecret } from "./lib/crypto.mjs";
import { BACKGROUND_DIR } from "./lib/render.mjs";
import { ensureDay, formatKickoff, localDate } from "./lib/football.mjs";
import { MAX_AGE_HOURS } from "./lib/config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_BUTTONS = 50;

const HELP =
  "How it works:\n" +
  "1. /matches shows today's matches. Tap the ones you want a post for.\n" +
  "2. Send a background image (best as a file, so it is not compressed).\n" +
  "3. When a match ends, the finished post arrives here automatically.\n\n" +
  "Tip: type a team name (e.g. Barcelona) to search today's matches.";

const matchButton = (m, selected) => [
  {
    text: `${selected ? "✅" : "⚽"} ${formatKickoff(m.kickoff)}  ${m.homeTeam} - ${m.awayTeam}`,
    callback_data: `select:${m.fixtureId}`,
  },
];

// ctx = { tg, ownerId }   ownerId = the customer who owns this bot, or null for the shared bot.

async function findUser(ctx, chatId) {
  if (ctx.ownerId) {
    const u = await prisma.user.findUnique({ where: { id: ctx.ownerId } });
    return u && u.telegramChatId === chatId ? u : null;
  }
  return prisma.user.findFirst({ where: { telegramChatId: chatId, botToken: null } });
}

async function selectedIds(userId, fixtureIds) {
  const rows = await prisma.selection.findMany({ where: { userId, fixtureId: { in: fixtureIds } }, select: { fixtureId: true } });
  return new Set(rows.map((r) => r.fixtureId));
}

async function todaysMatches() {
  const date = localDate();
  await ensureDay(date);
  return prisma.match.findMany({ where: { day: date }, orderBy: [{ kickoff: "asc" }, { fixtureId: "asc" }] });
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
  if (leagues.size || teams.size) {
    matches = matches.filter((m) => leagues.has(m.leagueId) || teams.has(m.homeTeamId) || teams.has(m.awayTeamId));
  }
  if (search) matches = matches.filter((m) => `${m.homeTeam} ${m.awayTeam}`.toLowerCase().includes(search));
  matches = matches.slice(0, MAX_BUTTONS);

  if (!matches.length) {
    await tg.sendMessage(
      chatId,
      search ? "Nothing found for that name. Try another word, or send /matches again." : "No matches in your leagues today.",
    );
    return;
  }
  const chosen = await selectedIds(user.id, matches.map((m) => m.fixtureId));
  await tg.sendMessage(chatId, search ? "Found:" : "Pick the matches you want a post for (tap again to remove).", {
    reply_markup: { inline_keyboard: matches.map((m) => matchButton(m, chosen.has(m.fixtureId))) },
  });
}

async function handleStart(ctx, chatId, code) {
  const { tg } = ctx;

  // Customer's own bot: the first chat that presses Start becomes the owner's chat.
  if (ctx.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ctx.ownerId } });
    if (!owner) return;
    if (!owner.telegramChatId) {
      await prisma.user.update({ where: { id: owner.id }, data: { telegramChatId: chatId, telegramLinkedAt: new Date() } });
      await tg.sendMessage(chatId, "Connected! 🎉\n\n" + HELP);
      console.log(`Linked ${owner.email} to their own bot (chat ${chatId})`);
    } else if (owner.telegramChatId === chatId) {
      await tg.sendMessage(chatId, HELP);
    } else {
      await tg.sendMessage(chatId, "This bot is private.");
    }
    return;
  }

  // Shared demo bot: link with the code from the dashboard.
  if (!code) {
    await tg.sendMessage(chatId, "Open the Connect Telegram link from your Final Whistle dashboard to link this chat.");
    return;
  }
  const user = await prisma.user.findUnique({ where: { linkCode: code } });
  if (!user || user.botToken) {
    await tg.sendMessage(chatId, "This link is not valid. Please open the latest link from your dashboard.");
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkedAt: new Date() } });
  await tg.sendMessage(chatId, "Connected! 🎉\n\n" + HELP);
  console.log(`Linked ${user.email} to chat ${chatId}`);
}

// A background image arrived (photo or image file).
async function handleUpload(ctx, msg, chatId) {
  const { tg } = ctx;
  const user = await findUser(ctx, chatId);
  if (!user) return handleStart(ctx, chatId, null);

  let fileId = null;
  if (msg.document?.mime_type?.startsWith("image/")) fileId = msg.document.file_id;
  else if (msg.photo?.length) fileId = msg.photo[msg.photo.length - 1].file_id;
  if (!fileId) return;

  const open = await prisma.selection.findMany({
    where: {
      userId: user.id,
      status: "SELECTED",
      match: { kickoff: { gte: new Date(Date.now() - MAX_AGE_HOURS * 3600e3) } },
    },
    include: { match: true },
    orderBy: { createdAt: "asc" },
  });
  if (!open.length) {
    await tg.sendMessage(chatId, "Select a match first with /matches, then send the background image.");
    return;
  }

  let file;
  try {
    file = await tg.downloadTelegramFile(fileId, BACKGROUND_DIR, `${user.id}_${Date.now()}`);
  } catch (e) {
    await tg.sendMessage(chatId, `Could not use that image: ${e.message}`);
    return;
  }

  if (open.length === 1) {
    await prisma.selection.update({ where: { id: open[0].id }, data: { backgroundPath: file } });
    await tg.sendMessage(chatId, `Background saved for ${open[0].match.homeTeam} - ${open[0].match.awayTeam}.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { pendingBackgroundPath: file } });
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
    const match = await prisma.match.findUnique({ where: { fixtureId } });
    if (!match) return answer("This match is no longer available.");

    const existing = await prisma.selection.findUnique({ where: { userId_fixtureId: { userId: user.id, fixtureId } } });
    let nowSelected;
    if (existing && existing.status === "COMPLETED") return answer("Already sent to you.");
    if (existing) {
      await prisma.selection.delete({ where: { id: existing.id } });
      nowSelected = false;
    } else {
      if (match.kickoff.getTime() < Date.now() - MAX_AGE_HOURS * 3600e3) return answer("This match is too old.");
      await prisma.selection.create({ data: { userId: user.id, fixtureId } });
      nowSelected = true;
    }
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
    const where =
      arg === "all"
        ? { userId: user.id, status: "SELECTED" }
        : { userId: user.id, status: "SELECTED", fixtureId: Number(arg) };
    const res = await prisma.selection.updateMany({ where, data: { backgroundPath: path } });
    await prisma.user.update({ where: { id: user.id }, data: { pendingBackgroundPath: null } });
    await answer(res.count ? "Background saved ✅" : "No matching selection.");
    await tg.api("editMessageText", {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: res.count ? `Background saved for ${res.count} match(es). ✅` : "No matching selection.",
    });
    return;
  }

  await answer("Unknown action.");
}

async function handle(ctx, update) {
  if (update.callback_query) return handleCallback(ctx, update.callback_query);

  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);

  if (msg.photo || msg.document) return handleUpload(ctx, msg, chatId);
  if (typeof msg.text !== "string") return;

  const text = msg.text.trim();
  const start = text.match(/^\/start(?:\s+(\S+))?$/);
  if (start) return handleStart(ctx, chatId, start[1]);

  const user = await findUser(ctx, chatId);
  if (!user) return handleStart(ctx, chatId, null);

  if (/^\/matches\b/i.test(text)) return sendMatchList(ctx, chatId, user, null);
  if (text.startsWith("/")) return ctx.tg.sendMessage(chatId, HELP);
  return sendMatchList(ctx, chatId, user, text.toLowerCase());
}

// One long-polling loop per bot.
async function pollLoop(entry) {
  const { tg, label } = entry;
  const me = await tg.api("getMe");
  if (!me.ok) {
    console.error(`[${label}] Telegram rejected this bot token: ${me.description}`);
    entry.failed = true;
    return;
  }
  await tg.api("deleteWebhook"); // a webhook would block polling
  await tg.api("setMyCommands", {
    commands: [
      { command: "matches", description: "Today's matches" },
      { command: "help", description: "How it works" },
    ],
  });
  console.log(`[${label}] bot @${me.result.username} is running`);

  let offset = 0;
  while (!entry.stop) {
    const res = await tg.api("getUpdates", { timeout: 25, offset, allowed_updates: ["message", "callback_query"] });
    if (entry.stop) break;
    if (!res.ok) {
      console.error(`[${label}] getUpdates error: ${res.description}`);
      if (res.error_code === 409) console.error(`[${label}] This bot has a webhook or another poller. Use a separate bot.`);
      await sleep(5000);
      continue;
    }
    for (const update of res.result) {
      offset = update.update_id + 1;
      try {
        await handle(entry.ctx, update);
      } catch (e) {
        console.error(`[${label}] failed to handle update:`, e);
      }
    }
  }
  console.log(`[${label}] bot stopped`);
}

const running = new Map(); // token -> { stop, ctx, tg, label }

async function syncBots() {
  const wanted = new Map(); // token -> { ownerId, label }
  if (sharedToken) wanted.set(sharedToken, { ownerId: null, label: "shared bot" });

  const owners = await prisma.user.findMany({ where: { botToken: { not: null } }, select: { id: true, email: true, botToken: true } });
  for (const o of owners) {
    try {
      wanted.set(decryptSecret(o.botToken), { ownerId: o.id, label: o.email });
    } catch (e) {
      console.error(`[${o.email}] cannot read the saved bot token: ${e.message}`);
    }
  }

  for (const [token, info] of wanted) {
    const existing = running.get(token);
    if (existing && !existing.failed) continue;
    const tg = makeTelegram(token);
    const entry = { stop: false, failed: false, tg, label: info.label, ctx: { tg, ownerId: info.ownerId } };
    running.set(token, entry);
    pollLoop(entry).catch((e) => console.error(`[${info.label}] polling crashed:`, e));
  }
  for (const [token, entry] of running) {
    if (!wanted.has(token)) {
      entry.stop = true;
      running.delete(token);
    }
  }
}

async function main() {
  console.log("Bot manager started. (Ctrl+C to stop)");
  while (true) {
    try {
      await syncBots();
    } catch (e) {
      console.error("syncBots failed:", e.message);
    }
    await sleep(30000);
  }
}

main();
