import {describe,expect,it} from 'vitest';
import {leagueAccents,LEAGUE_ACCENTS} from '../render/league-accents.js';
import {buildEventsHtml} from '../scripts/lib/events.mjs';
import {referenceScenarios} from './fixtures/match-reference-scenarios.mjs';
const rows=(s:string)=>(s.match(/class="event"/g)??[]).length;
describe('original Match reference scenarios',()=>{
 it.each(referenceScenarios)('renders collage $id with mirrored, bounded event rows',s=>{
  const r=buildEventsHtml(s.events,s.match);
  expect(r.total_events).toBe(rows(r.home_events_html)+rows(r.away_events_html));
  expect(r.home_events_html+r.away_events_html).not.toMatch(/undefined|NaN|\[object Object\]/);
  expect(rows(r.home_events_html)).toBeLessThanOrEqual(5);
  expect(rows(r.away_events_html)).toBeLessThanOrEqual(5);
  expect([s.match.home_score,s.match.away_score]).toEqual([s.hs,s.as]);
 });
 it('keeps scored versus missed penalties separate and same initial/surname players distinct',()=>{
  const s=referenceScenarios.find(s=>s.id===9002)!;
  const r=buildEventsHtml(s.events,s.match);
  expect(r.home_events_html).toContain('stroke="#ffffff"');
  expect(r.away_events_html).toContain('stroke="#e50914"');
  const same=referenceScenarios.find(s=>s.id===9009)!;
  expect(rows(buildEventsHtml(same.events,same.match).home_events_html)).toBe(2);
 });
 it('retains grouped goals and chronological added/extra-time labels',()=>{
  const s=referenceScenarios.find(s=>s.id===9010)!;
  const r=buildEventsHtml([...s.events].reverse(),s.match);
  expect(r.home_events_html).toContain("45+2, 90+4'");
  expect(r.away_events_html).toContain("30, 120+1'");
  expect(r.away_events_html).toContain("60'");
  expect(r.away_events_html).toContain("100'");
  expect(r.away_events_html).not.toContain("60, 100'");
 });
 it('shows missing-player minutes and leaves unavailable events blank without inventing scorers',()=>{
  const s=referenceScenarios.find(s=>s.id===9011)!;
  expect(buildEventsHtml(s.events,s.match).home_events_html).toContain('<span class="minute">15\'</span></div>');
  const empty=referenceScenarios.find(s=>s.id===9017)!;
  expect(buildEventsHtml(empty.events,empty.match).total_events).toBe(0);
  expect(buildEventsHtml(null,null).total_events).toBe(0);
 });
 it('preserves filtering and own-goal beneficiary placement',()=>{
  const blank=referenceScenarios.find(s=>s.id===9013)!;
  expect(buildEventsHtml(blank.events,blank.match).total_events).toBe(0);
  const own=referenceScenarios.find(s=>s.id===9004)!;
  const result=buildEventsHtml(own.events,own.match);
  expect(result.home_events_html).toContain('F. Tomori');
  expect(result.away_events_html).not.toContain('F. Tomori');
 });
 it('removes confirmed duplicate goals before own-goal reconciliation, but keeps ambiguous same-minute goals',()=>{
  const s=referenceScenarios.find(s=>s.id===9004)!;
  expect(buildEventsHtml([...s.events,s.events[1]],s.match)).toEqual(buildEventsHtml(s.events,s.match));
  const g=s.events[0];
  const single={...s.match,home_score:1,away_score:0};
  expect(buildEventsHtml([g,g],single).home_events_html).not.toContain('10, 10');
  expect(buildEventsHtml([g,g],{...single,home_score:2}).home_events_html).toContain('10, 10');
 });
 it('does not collapse goal records when only the total, not the per-team score, agrees',()=>{
  const s=referenceScenarios.find(s=>s.id===9004)!;
  const home=s.events[0],away={...s.events[2],detail:'Normal Goal'};
  expect(buildEventsHtml([home,home,away],{...s.match,home_score:2,away_score:0}).home_events_html).toContain('10, 10');
 });
 it('deduplicates straight reds and keeps opposite-team yellows from creating false second yellows',()=>{
  const s=referenceScenarios.find(s=>s.id===9006)!;
  const red=s.events[1];
  expect(buildEventsHtml([red,red],s.match).total_events).toBe(1);
  const yellow={...red,detail:'Yellow Card',team:{id:2,name:s.away},player:red.player};
  const r=buildEventsHtml([yellow,red],s.match);
  expect(r.home_events_html).toContain('card-icon red');
  expect(r.home_events_html).not.toContain('second-yellow');
 });
 it('renders one second-yellow dismissal when the API supplies both red and second-yellow descriptions',()=>{
  const s=referenceScenarios.find(s=>s.id===9006)!;
  const red=s.events[1];
  const second={...red,detail:'Second Yellow card'};
  const r=buildEventsHtml([red,second],s.match);
  expect(r.total_events).toBe(1);
  expect(r.home_events_html).toContain('second-yellow');
 });
 it('does not infer a second yellow from two unidentified players',()=>{
  const s=referenceScenarios.find(s=>s.id===9006)!;
  const unknown={...s.events[1],player:{id:null,name:null}};
  const r=buildEventsHtml([{...unknown,detail:'Yellow Card'},unknown],s.match);
  expect(r.home_events_html).toContain('card-icon red');
  expect(r.home_events_html).not.toContain('second-yellow');
 });
 it('uses stable team IDs before names and rejects a conflicting third team',()=>{
  const s=referenceScenarios[0];
  expect(buildEventsHtml(s.events,s.match).total_events).toBeGreaterThan(0);
  const invalid={...s.events[0],team:{id:3,name:s.home}};
  expect(buildEventsHtml([invalid],s.match).total_events).toBe(0);
 });
});
describe('reference league-line gradients',()=>{
 it.each([39,140,135,78,61,2,5])('uses reference-only palette for ID %i',id=>{
  const c=leagueAccents(id);
  expect(c.left).toBe(`linear-gradient(90deg, ${LEAGUE_ACCENTS[id].slice(0,3).join(', ')})`);
  expect(c.right).toBe(`linear-gradient(90deg, ${LEAGUE_ACCENTS[id].slice(3).join(', ')})`);
 });
 it('retains original white for unknown, malformed and absent IDs',()=>{
  for(const id of [undefined,null,999,'Premier League','39',NaN,-1,{}])
   expect(leagueAccents(id)).toEqual({left:'rgba(255, 255, 255, 0.45)',right:'rgba(255, 255, 255, 0.45)'});
 });
 it('supports legacy logo IDs but an explicit ID always wins',()=>{
  expect(leagueAccents(undefined,'https://media.api-sports.io/football/leagues/39.png')).toEqual(leagueAccents(39));
  expect(leagueAccents(140,'https://media.api-sports.io/football/leagues/39.png')).toEqual(leagueAccents(140));
  expect(leagueAccents(999,'https://media.api-sports.io/football/leagues/39.png')).toEqual(leagueAccents());
 });
});
