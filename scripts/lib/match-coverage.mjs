// API-Football v3 identities (team and competition namespaces are distinct).
// Reference IDs supplied for this expansion; authenticated metadata verification
// is separate from discovery and must never happen per fixture or per user.
export const FEATURED_MATCH_TEAMS = Object.freeze([
  Object.freeze({id:26,name:'Argentina'}),
  Object.freeze({id:6,name:'Brazil'}),
  Object.freeze({id:9568,name:'Inter Miami'}),
]);
export const EUROPA_LEAGUE_ID = 3;
// Reviewed reference competition IDs: MLS (including playoffs), Leagues Cup,
// CONCACAF Champions Cup, US Open Cup, FIFA Club World Cup. Unknown competitions
// fail closed; extend this set only after verifying official provider metadata.
export const INTER_MIAMI_COMPETITIONS = new Set([253,772,16,257,15]);
export const MATCH_COVERAGE_VERSION = 'coverage-v1';
const nationalTeams = new Set([26,6]);
export function includesMatchFixture(fixture, leagues) {
  if (leagues.has(fixture.league.id)) return true;
  const teams=[fixture.teams.home.id,fixture.teams.away.id];
  if (teams.some(id=>nationalTeams.has(id))) return true;
  if (!teams.includes(9568)) return false;
  // Positive competition IDs avoid treating every unfamiliar cup as official.
  return INTER_MIAMI_COMPETITIONS.has(fixture.league.id) &&
    typeof fixture.league.name==='string' && fixture.league.name.trim()!=='' &&
    !/friendl|exhibition|testimonial/i.test(fixture.league.name);
}
