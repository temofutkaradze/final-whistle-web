// Customer bot.
// Run with:  npm run bot      (keep this window open)
// Long polling: no public URL / ngrok needed.
// IMPORTANT: use a NEW bot token. A bot with a webhook (like the one n8n uses)
// cannot be polled at the same time.
//
// Commands:  /start <code>  link chat to account     /matches  today's matches
//            type a team name  -> search             send an image -> background

import { prisma } from "./lib/db.mjs";
import { api, sendMessage, downloadTelegramFile } from "./lib/telegram.mjs";
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

async function findUser(chatId) {
  return prisma.user.findFirst({ where: { telegramChatId: chatId } });
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

// League ids the customer chose when signing up. Empty = show every league we store.
async function userLeagues(userId) {
  const subs = await prisma.subscription.findMany({ where: { userId, status: "ACTIVE" }, select: { leagueIds: true } });
  return new Set(subs.flatMap((s) => s.leagueIds));
}

async function sendMatchList(chatId, user, search) {
  let matches;
  try {
    matches = await todaysMatches();
  } catch (e) {
    console.error("loading matches failed:", e.message);
    await sendMessage(chatId, "Could not load today's matches right now. Please try again in a few minutes.");
    return;
  }
  const leagues = await userLeagues(user.id);
  if (leagues.size) matches = matches.filter((m) => leagues.has(m.leagueId));
  if (search) matches = matches.filter((m) => `${m.homeTeam} ${m.awayTeam}`.toLowerCase().includes(search));
  matches = matches.slice(0, MAX_BUTTONS);

  if (!matches.length) {
    await sendMessage(
      chatId,
      search ? "Nothing found for that name. Try another word, or send /matches again." : "No matches in your leagues today.",
    );
    return;
  }
  const chosen = await selectedIds(user.id, matches.map((m) => m.fixtureId));
  await sendMessage(chatId, search ? "Found:" : "Pick the matches you want a post for (tap again to remove).", {
    reply_markup: { inline_keyboard: matches.map((m) => matchButton(m, chosen.has(m.fixtureId))) },
  });
}

async function handleStart(chatId, code) {
  if (!code) {
    await sendMessage(chatId, "Open the Connect Telegram link from your Final Whistle dashboard to link this chat.");
    return;
  }
  const user = await prisma.user.findUnique({ where: { linkCode: code } });
  if (!user) {
    await sendMessage(chatId, "This link is not valid. Please open the latest link from your dashboard.");
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkedAt: new Date() } });
  await sendMessage(chatId, "Connected! 🎉\n\n" + HELP);
  console.log(`Linked ${user.email} to chat ${chatId}`);
}

// A background image arrived (photo or image file).
async function handleUpload(msg, chatId) {
  const user = await findUser(chatId);
  if (!user) return handleStart(chatId, null);

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
    await sendMessage(chatId, "Select a match first with /matches, then send the background image.");
    return;
  }

  let file;
  try {
    file = await downloadTelegramFile(fileId, BACKGROUND_DIR, `${user.id}_${Date.now()}`);
  } catch (e) {
    await sendMessage(chatId, `Could not use that image: ${e.message}`);
    return;
  }

  if (open.length === 1) {
    await prisma.selection.update({ where: { id: open[0].id }, data: { backgroundPath: file } });
    await sendMessage(chatId, `Background saved for ${open[0].match.homeTeam} - ${open[0].match.awayTeam}.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { pendingBackgroundPath: file } });
  const buttons = open.map((s) => [{ text: `⚽ ${s.match.homeTeam} - ${s.match.awayTeam}`, callback_data: `bg:${s.fixtureId}` }]);
  buttons.push([{ text: "All my selected matches", callback_data: "bg:all" }]);
  await sendMessage(chatId, "Which match is this background for?", { reply_markup: { inline_keyboard: buttons } });
}

async function handleCallback(cb) {
  const chatId = String(cb.message?.chat?.id ?? "");
  const user = await findUser(chatId);
  const answer = (text) => api("answerCallbackQuery", { callback_query_id: cb.id, text });
  if (!user) return answer("Please link your account first.");

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
      await api("editMessageReplyMarkup", {
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
    await api("editMessageText", {
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: res.count ? `Background saved for ${res.count} match(es). ✅` : "No matching selection.",
    });
    return;
  }

  await answer("Unknown action.");
}

async function handle(update) {
  if (update.callback_query) return handleCallback(update.callback_query);

  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);

  if (msg.photo || msg.document) return handleUpload(msg, chatId);
  if (typeof msg.text !== "string") return;

  const text = msg.text.trim();
  const start = text.match(/^\/start(?:\s+(\S+))?$/);
  if (start) return handleStart(chatId, start[1]);

  const user = await findUser(chatId);
  if (!user) return handleStart(chatId, null);

  if (/^\/matches\b/i.test(text)) return sendMatchList(chatId, user, null);
  if (text.startsWith("/")) return sendMessage(chatId, HELP);
  return sendMatchList(chatId, user, text.toLowerCase());
}

async function main() {
  const me = await api("getMe");
  if (!me.ok) {
    console.error("Telegram rejected the token:", me.description);
    process.exit(1);
  }
  await api("setMyCommands", {
    commands: [
      { command: "matches", description: "Today's matches" },
      { command: "help", description: "How it works" },
    ],
  });
  console.log(`Bot @${me.result.username} is running. Waiting for messages... (Ctrl+C to stop)`);

  let offset = 0;
  while (true) {
    const res = await api("getUpdates", { timeout: 30, offset, allowed_updates: ["message", "callback_query"] });
    if (!res.ok) {
      console.error("getUpdates error:", res.description);
      if (res.error_code === 409) console.error("This bot already has a webhook or another poller. Use a separate new bot for this script.");
      await sleep(5000);
      continue;
    }
    for (const update of res.result) {
      offset = update.update_id + 1;
      try {
        await handle(update);
      } catch (e) {
        console.error("Failed to handle update:", e);
      }
    }
  }
}

main();
