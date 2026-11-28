import {describe,it,expect} from 'vitest';
import {includesMatchFixture,FEATURED_MATCH_TEAMS} from '../scripts/lib/match-coverage.mjs';
import {FAVORITE_LEAGUES} from '../scripts/lib/config.mjs';
import {LEAGUES} from '@/lib/leagues';
// Synthetic fixtures only; these are not captured provider responses.
const fixture=(team:number,league:number,name='Official Test Cup',round='Final')=>({league:{id:league,name,round},teams:{home:{id:team},away:{id:900001}}});
describe('exact-ID Match coverage',()=>{
 it.each([26,6])('includes senior team %s in official competitions and international friendlies',team=>{
  for(const league of [1,9,34,10,99001])expect(includesMatchFixture(fixture(team,league),FAVORITE_LEAGUES)).toBe(true);
  const away=fixture(900002,10);away.teams.away.id=team;expect(includesMatchFixture(away,FAVORITE_LEAGUES)).toBe(true);
 });
 it.each([253,772,16,257,15])('includes only Inter Miami in official competition %s',league=>{
  expect(includesMatchFixture(fixture(9568,league),FAVORITE_LEAGUES)).toBe(true);
  expect(includesMatchFixture(fixture(9569,league),FAVORITE_LEAGUES)).toBe(false);
 });
 it('does not invent official status for an unknown Miami competition',()=>{
  expect(includesMatchFixture(fixture(9568,99001),FAVORITE_LEAGUES)).toBe(false);
 });
 it.each([[667,'Friendlies Clubs'],[667,'Unknown label'],[99001,'Club Friendlies'],[99002,'Exhibition']])('excludes Miami friendlies %s / %s',(id,name)=>{
  expect(includesMatchFixture(fixture(9568,Number(id),String(name)),FAVORITE_LEAGUES)).toBe(false);
 });
 it.each(['Qualifying Round','Play-offs','League Stage','Round of 16','Final'])('includes Europa %s without stage-specific rules',round=>{
  expect(includesMatchFixture(fixture(900002,3,'UEFA Europa League',round),FAVORITE_LEAGUES)).toBe(true);
 });
 it('preserves all existing competition rules and exact team namespaces',()=>{
  for(const league of [39,140,135,78,61,2,5])expect(includesMatchFixture(fixture(900001,league),FAVORITE_LEAGUES)).toBe(true);
  for(const team of [10171,16200,12502,900002,9569])expect(includesMatchFixture(fixture(team,253,'MLS'),FAVORITE_LEAGUES)).toBe(false);
  expect(includesMatchFixture(fixture(900002,6,'Africa Cup of Nations'),FAVORITE_LEAGUES)).toBe(false);
  expect(FEATURED_MATCH_TEAMS.map(t=>t.id)).toEqual([26,6,9568]);expect(LEAGUES.some(l=>l.id===3)).toBe(true);
 });
});
