import {describe,it,expect} from 'vitest';
import {LEAGUE_ACCENTS,leagueAccents} from '../render/league-accents.js';
import {MATCH_ACCENTS,matchLeagueAccents,mirrorHorizontalGradient} from '../render/match-accents.js';

describe('Match-only competition line accents',()=>{
 it('mirrors every established and new competition line without changing shared News accents',()=>{
  const existing=[39,140,135,78,61,2,5];
  for(const id of existing){
   const shared=leagueAccents(id),match=matchLeagueAccents(id);
   expect(match.left).toBe(shared.left);expect(match.right).toBe(mirrorHorizontalGradient(shared.left));
   expect(LEAGUE_ACCENTS[id]).toHaveLength(6);
  }
  for(const id of [1,3,9,10,15,16,34,253,257,772]){
   const value=matchLeagueAccents(id);
   expect(value.right).toBe(mirrorHorizontalGradient(value.left));
  }
  expect(leagueAccents(39).right).toBe(`linear-gradient(90deg, ${LEAGUE_ACCENTS[39].slice(3).join(', ')})`);
 });

 it('preserves asymmetric stop offsets and transparency by reversing gradient direction',()=>{
  const input='linear-gradient(90deg, rgba(12,34,56,.2) 0%, #abcdef 30%, rgb(90,80,70) 100%)';
  expect(mirrorHorizontalGradient(input)).toBe('linear-gradient(270deg, rgba(12,34,56,.2) 0%, #abcdef 30%, rgb(90,80,70) 100%)');
  expect(mirrorHorizontalGradient('linear-gradient(to right, #fff 0%, #000 100%)')).toBe('linear-gradient(to left, #fff 0%, #000 100%)');
  expect(mirrorHorizontalGradient('rgba(255,255,255,.45)')).toBe('rgba(255,255,255,.45)');
 });

 it('uses only the new Match palettes and keeps MLS as a solid white line',()=>{
  expect(Object.keys(MATCH_ACCENTS).map(Number).sort((a,b)=>a-b)).toEqual([1,3,9,10,15,16,34,253,257,772]);
  expect(matchLeagueAccents(253)).toEqual({left:'#fff',right:'#fff'});
 });
});
