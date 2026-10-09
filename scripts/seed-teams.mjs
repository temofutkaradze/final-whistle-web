// One-time: downloads the club lists of the domestic leagues so customers can pick clubs.
// Run:  npm run seed:teams     (about 5-10 API requests, safe to run again)

import { prisma } from "./lib/db.mjs";
import { apiGet } from "./lib/football.mjs";
import { FAVORITE_LEAGUES } from "./lib/config.mjs";

const CUPS = new Set([2, 5]); // Champions League, Nations League have no fixed club list
const now = new Date();
const currentSeason = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

for (const leagueId of FAVORITE_LEAGUES) {
  if (CUPS.has(leagueId)) continue;
  let rows = [];
  for (const season of [currentSeason, currentSeason + 1, currentSeason - 1]) {
    rows = await apiGet("teams", { league: leagueId, season });
    if (rows.length) break;
  }
  const data = rows.map((r) => ({ id: r.team.id, name: r.team.name, logo: r.team.logo, leagueId }));
  const res = await prisma.team.createMany({ data, skipDuplicates: true });
  console.log(`league ${leagueId}: ${rows.length} clubs found, ${res.count} new`);
}
await prisma.$disconnect();
