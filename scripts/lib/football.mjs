// API-Football access + the shared match cache (table "Match").
// Rule: every request goes through apiGet(), which counts it and stops at the daily limit.

import { prisma } from "./db.mjs";
import { DAILY_API_LIMIT, DEAD, FAVORITE_LEAGUES, FINISHED } from "./config.mjs";
import { checkpointFromFixture } from './live-checkpoint.mjs';
import {includesMatchFixture,MATCH_COVERAGE_VERSION} from './match-coverage.mjs';

const BASE = "https://v3.football.api-sports.io";

// ---------------------------------------------------------------------------
// Time zones. Every customer has their own zone (default = TZ from config).
// Matches are stored once per UTC day; a customer's "today" is their local day,
// which touches one or two UTC days.
// ---------------------------------------------------------------------------

export { localDate, formatKickoff, utcDate, startOfLocalDay, localDayRange, isValidTimeZone } from "./football/time.mjs";

async function countRequest() {
  const day = new Date().toISOString().slice(0, 10); // API limits reset at 00:00 UTC
  const row = await prisma.apiUsage.upsert({
    where: { day },
    create: { day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count > DAILY_API_LIMIT) {
    throw new Error(`Daily API-Football limit reached (${DAILY_API_LIMIT}). Try again tomorrow.`);
  }
  return row.count;
}

export async function apiGet(endpoint, params) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is missing in .env");

  const used = await countRequest();
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  const errs = data.errors;
  const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0;
  if (!res.ok || hasErr) {
    throw new Error(`API-Football error: ${hasErr ? JSON.stringify(errs) : "HTTP " + res.status}`);
  }
  console.log(`[api] ${endpoint} ${JSON.stringify(params)} (request ${used} today)`);
  return data.response ?? [];
}

// ---------------------------------------------------------------------------
// Day list: 1 request per day, shared by everybody.
// ---------------------------------------------------------------------------

const inFlight = new Map();

export function ensureDay(date) {
  if (!inFlight.has(date)) {
    inFlight.set(
      date,
      loadDay(date).finally(() => inFlight.delete(date)),
    );
  }
  return inFlight.get(date);
}

async function loadDay(date) {
  // The key includes the league list, so changing EXTRA_LEAGUES re-downloads today's list once.
  const key = `utc:${date}|${[...FAVORITE_LEAGUES].sort((a, b) => a - b).join(",")}|${MATCH_COVERAGE_VERSION}`;
  if (await prisma.fixtureDay.findUnique({ where: { date: key } })) return;

  const fixtures = await apiGet("fixtures", { date }); // "date" is a UTC day
  const wanted = [...new Map(fixtures.filter((f) => includesMatchFixture(f,FAVORITE_LEAGUES) && !["PST", "CANC"].includes(f.fixture.status.short)).map(f=>[f.fixture.id,f])).values()];
  const storedTeams=new Set();

  for (const f of wanted) {
    const data = {
      day: date,
      leagueId: f.league.id,
      leagueName: f.league.name,
      leagueLogo: f.league.logo,
      homeTeam: f.teams.home.name,
      homeTeamId: f.teams.home.id,
      awayTeamId: f.teams.away.id,
      awayTeam: f.teams.away.name,
      homeLogo: f.teams.home.logo,
      awayLogo: f.teams.away.logo,
      kickoff: new Date(f.fixture.date),
      statusShort: f.fixture.status.short,
      homeScore: f.goals.home,
      awayScore: f.goals.away,
    };
    await prisma.match.upsert({ where: { fixtureId: f.fixture.id }, create: { fixtureId: f.fixture.id, ...data }, update: data });
    // Remember the clubs, so customers can pick them on the dashboard (never overwrite an existing row).
    for (const t of [f.teams.home, f.teams.away]) {
      if(storedTeams.has(t.id))continue;
      await prisma.team.upsert({
        where: { id: t.id },
        create: { id: t.id, name: t.name, logo: t.logo, leagueId: f.league.id },
        update: {},
      });
      storedTeams.add(t.id);
    }
  }
  await prisma.fixtureDay.upsert({ where: { date: key }, create: { date: key }, update: { fetchedAt: new Date() } });
  console.log(`[day] ${date}: ${wanted.length} matches stored`);
}

// ---------------------------------------------------------------------------
// Status check: ONE request per day-list answers "who finished?" for all tracked matches.
// (Same idea as the n8n "Check Fixture Status" node.)
// ---------------------------------------------------------------------------

export async function refreshStatuses(date, trackedMatches) {
  const fixtures = await apiGet("fixtures", { date }); // "date" is a UTC day
  const byId = new Map(fixtures.map((f) => [f.fixture.id, f]));
  const now = new Date();

  for (const m of trackedMatches) {
    const f = byId.get(m.fixtureId);
    const data = { lastCheckedAt: now };
    if (f) {
      data.statusShort = f.fixture.status.short;
      data.homeScore = f.goals.home;
      data.awayScore = f.goals.away;
      data.elapsedMinutes = Number.isInteger(f.fixture.status.elapsed) ? f.fixture.status.elapsed : null;
      data.extraMinutes = Number.isInteger(f.fixture.status.extra) ? f.fixture.status.extra : null;
    }
    const checkpoint = f && checkpointFromFixture(f, now);
    // Do not advance the cached check time without persisting its first eligible observation.
    await prisma.$transaction(async tx => {
      await tx.match.update({ where: { fixtureId: m.fixtureId }, data });
      if (checkpoint) await tx.match.updateMany({
        where: { fixtureId: m.fixtureId, liveCheckpointAt: null },
        data: { liveCheckpointAt: now, liveCheckpointJson: checkpoint },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Events: 1 request per finished match, stored once (same as the n8n "Get Match Events").
// ---------------------------------------------------------------------------

// Download the events (1 API request) without saving them. The worker decides whether they are good enough to keep.
export function fetchEvents(fixtureId) {
  return apiGet("fixtures/events", { fixture: fixtureId });
}

export async function saveEvents(fixtureId, events) {
  await prisma.match.update({
    where: { fixtureId },
    data: { eventsJson: events, finishedAt: new Date() },
  });
}

export const isFinished = (status) => FINISHED.has(status);
export const isDead = (status) => DEAD.has(status);
