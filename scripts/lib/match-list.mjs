// Preserve the existing day-cache fetch. Visibility follows display-timezone kickoff boundaries,
// not Match.day (the API/cache day is UTC). Never fetch another day for this extension.
export async function listAvailableMatches({ prisma, ensureDay, localDayRange, now = new Date() }) {
  const range = localDayRange(undefined, now);
  await ensureDay(range.date);
  return prisma.match.findMany({ where: { OR: [
    { kickoff: { gte: range.start, lt: range.end } },
    { kickoff: { gte: new Date(now.getTime() - 4 * 3600e3), lte: now } },
  ] }, orderBy: [{ kickoff: 'asc' }, { fixtureId: 'asc' }] });
}

export function filterMatchList(matches, { leagues, teams }, search, limit = 50) {
  return matches.filter(m => (!leagues.size && !teams.size || leagues.has(m.leagueId) || teams.has(m.homeTeamId) || teams.has(m.awayTeamId)) &&
    (!search || `${m.homeTeam} ${m.awayTeam}`.toLowerCase().includes(search))).slice(0, limit);
}
