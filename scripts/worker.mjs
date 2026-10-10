// Worker: finds finished matches, builds the post for every customer who picked the match,
// and sends it to their Telegram chat.
// Run with:  npm run worker      (keep this window open; the render server must run too)
//
// Same rules as the n8n workflow:
//   - wait 110 min after kickoff, give up after 24 h
//   - status check = 1 request per day list; events = 1 request per finished match
//   - a match is looked up ONCE and the result is shared by all customers
//   - old matches are deleted from our database after 48 h

import { unlink } from "node:fs/promises";
import { prisma } from "./lib/db.mjs";
import { telegramForUser } from "./lib/telegram.mjs";
import { buildEventsHtml } from "./lib/events.mjs";
import { DEFAULT_BACKGROUND, downloadBackground, fileExists, pageNameForImage, renderPost } from "./lib/render.mjs";
import { fetchEventsOnce, isDead, isFinished, localDate, refreshStatuses } from "./lib/football.mjs";
import {
  CHECK_INTERVAL_MIN,
  CLEANUP_AFTER_HOURS,
  DELAY_MINUTES,
  MAX_AGE_HOURS,
  MAX_ATTEMPTS,
  RETRY_DELAY_MIN,
} from "./lib/config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minutes = (n) => n * 60e3;
const hours = (n) => n * 3600e3;

// Sends a plain message to the customer through THEIR bot; never lets a Telegram error stop the worker.
async function notify(user, text) {
  try {
    await telegramForUser(user).sendMessage(user.telegramChatId, text);
  } catch (e) {
    console.error("notify failed:", e.message);
  }
}

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

async function sendOne(sel, match, eventsHtml) {
  const brand = sel.user.brands[0];
  const jpg = await renderPost({
    fixture_id: `${match.fixtureId}_${sel.id}`, // unique per customer, so files never collide
    page_name: pageNameForImage(brand?.name ?? "final whistle"),
    ...(await pickBackground(sel, brand)),
    league_logo: match.leagueLogo,
    home_logo: match.homeLogo,
    away_logo: match.awayLogo,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    home_score: match.homeScore,
    away_score: match.awayScore,
    ...eventsHtml,
  });
  await telegramForUser(sel.user).sendDocument(sel.user.telegramChatId, jpg, `${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
}

async function tick() {
  const now = Date.now();
  const sels = await prisma.selection.findMany({
    where: {
      status: "SELECTED",
      user: { telegramChatId: { not: null } },
      match: { kickoff: { gte: new Date(now - hours(MAX_AGE_HOURS)), lte: new Date(now - minutes(DELAY_MINUTES)) } },
    },
    include: { match: true, user: { include: { brands: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  if (!sels.length) return;

  // 1) Status check, once per day list, only if some match is due for a look.
  const due = new Map();
  for (const s of sels) {
    const m = s.match;
    if (m.finishedAt || isFinished(m.statusShort) || isDead(m.statusShort)) continue;
    if (m.lastCheckedAt && now - m.lastCheckedAt.getTime() < minutes(CHECK_INTERVAL_MIN)) continue;
    due.set(m.fixtureId, m);
  }
  const byDay = new Map();
  for (const m of due.values()) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
  for (const [day, list] of byDay) await refreshStatuses(day, list);

  // 2) Events for every finished match that does not have them yet (shared by all customers).
  const ids = [...new Set(sels.map((s) => s.fixtureId))];
  let matches = await prisma.match.findMany({ where: { fixtureId: { in: ids } } });
  for (const m of matches) {
    if (isFinished(m.statusShort) && !m.eventsJson) await fetchEventsOnce(m.fixtureId);
  }
  matches = await prisma.match.findMany({ where: { fixtureId: { in: ids } } });
  const matchById = new Map(matches.map((m) => [m.fixtureId, m]));
  const htmlCache = new Map();

  // 3) Build + send for each customer (one at a time: the render server is heavy).
  for (const sel of sels) {
    const match = matchById.get(sel.fixtureId);
    if (!match) continue;

    if (isDead(match.statusShort)) {
      await prisma.selection.update({ where: { id: sel.id }, data: { status: "FAILED", lastError: `match ${match.statusShort}` } });
      await notify(sel.user, `${match.homeTeam} - ${match.awayTeam} was postponed or cancelled, so there is no post.`);
      continue;
    }
    if (!isFinished(match.statusShort) || !match.eventsJson) continue;
    if (sel.attempts > 0 && now - sel.updatedAt.getTime() < minutes(RETRY_DELAY_MIN)) continue;

    const claimed = await prisma.selection.updateMany({ where: { id: sel.id, status: "SELECTED" }, data: { status: "SENDING" } });
    if (claimed.count === 0) continue;

    try {
      if (!htmlCache.has(match.fixtureId)) {
        htmlCache.set(
          match.fixtureId,
          buildEventsHtml(match.eventsJson, {
            home_team: match.homeTeam,
            away_team: match.awayTeam,
            home_score: match.homeScore,
            away_score: match.awayScore,
          }),
        );
      }
      await sendOne(sel, match, htmlCache.get(match.fixtureId));
      await prisma.selection.update({ where: { id: sel.id }, data: { status: "COMPLETED", sentAt: new Date() } });
      console.log(`[sent] ${match.homeTeam} - ${match.awayTeam} -> ${sel.user.email}`);
    } catch (e) {
      const attempts = sel.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      console.error(`[error] ${match.homeTeam} - ${match.awayTeam} -> ${sel.user.email} (attempt ${attempts}):`, e.message);
      await prisma.selection.update({
        where: { id: sel.id },
        data: { status: failed ? "FAILED" : "SELECTED", attempts, lastError: String(e.message).slice(0, 500) },
      });
      if (failed) await notify(sel.user, `Sorry, the post for ${match.homeTeam} - ${match.awayTeam} could not be created.`);
    }
  }
}

// Daily housekeeping: the shared match table does not grow forever.
async function cleanup() {
  const old = await prisma.match.findMany({
    where: { kickoff: { lt: new Date(Date.now() - hours(CLEANUP_AFTER_HOURS)) } },
    select: { fixtureId: true },
  });
  if (old.length) {
    const ids = old.map((m) => m.fixtureId);
    const sels = await prisma.selection.findMany({ where: { fixtureId: { in: ids } }, select: { backgroundPath: true } });
    for (const s of sels) if (s.backgroundPath) await unlink(s.backgroundPath).catch(() => {});
    await prisma.match.deleteMany({ where: { fixtureId: { in: ids } } }); // selections go with them
    console.log(`[cleanup] removed ${old.length} old matches`);
  }
  const cutoffDay = localDate(new Date(Date.now() - hours(72)));
  await prisma.fixtureDay.deleteMany({ where: { date: { lt: cutoffDay } } });
  await prisma.apiUsage.deleteMany({ where: { day: { lt: new Date(Date.now() - hours(24 * 7)).toISOString().slice(0, 10) } } });
}

async function main() {
  // A crash while sending leaves rows in SENDING; put them back in the queue.
  await prisma.selection.updateMany({ where: { status: "SENDING" }, data: { status: "SELECTED" } });
  console.log("Worker started. Checking every minute... (Ctrl+C to stop)");

  let lastCleanup = 0;
  while (true) {
    try {
      await tick();
      if (Date.now() - lastCleanup > hours(1)) {
        await cleanup();
        lastCleanup = Date.now();
      }
    } catch (e) {
      console.error("[tick failed]", e.message);
    }
    await sleep(60000);
  }
}

main();
