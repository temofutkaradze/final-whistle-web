import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {competitionLabel,competitionPresentation,competitionSymbolSize,applyMatchPresentation}=require('../render/match-presentation.js');
const {validateMatch,validateMatchImage}=require('../render/security.js');
const {leagueLogoSize}=require('../render/league-logo-sizing.js');
const templates=['classic','panel','frame','stripe'];
const templateHtml=(name:string)=>readFileSync(`render/templates/${name}.html`,'utf8');

describe('new competition markers',()=>{
 it('uses exact competitions and teams while preserving the UEL label helper',()=>{
  expect(competitionLabel(3)).toBe('UEL');
  expect(competitionPresentation({leagueId:3}).asset).toBe('3.svg');
  expect(competitionPresentation({leagueId:253,homeTeamId:9568,awayTeamId:1}).asset).toBe('253.svg');
  expect(competitionPresentation({leagueId:253,homeTeamId:1,awayTeamId:2}).kind).toBe('logo');
  for(const teamId of [26,6])expect(competitionPresentation({leagueId:10,homeTeamId:teamId,awayTeamId:1}).asset).toBe('10.svg');
  expect(competitionPresentation({leagueId:10,homeTeamId:1,awayTeamId:2}).kind).toBe('logo');
 });

 it('validates optional renderer team IDs as positive safe integers',()=>{
  expect(validateMatch({home_team_id:26,away_team_id:9568}).home_team_id).toBe(26);
  expect(()=>validateMatch({home_team_id:'26'})).toThrow('Invalid team ID');
  expect(()=>validateMatch({away_team_id:Number.MAX_SAFE_INTEGER+1})).toThrow('Invalid team ID');
 });

 it('keeps established labels before the new-team abbreviation fallbacks',()=>{
  expect(competitionPresentation({leagueId:5,homeTeamId:26,awayTeamId:1})).toMatchObject({kind:'label',label:'UNL',established:true});
  expect(competitionPresentation({leagueId:6,homeTeamId:9568,awayTeamId:1})).toMatchObject({kind:'label',label:'CAF',established:true});
  for(const [leagueId,label] of [[1,'WC'],[34,'WCQ'],[9,'CA']])expect(competitionPresentation({leagueId,homeTeamId:26,awayTeamId:1}).label).toBe(label);
  for(const [leagueId,label] of [[772,'LC'],[16,'CCC'],[257,'USOC'],[15,'CWC']])expect(competitionPresentation({leagueId,homeTeamId:9568,awayTeamId:1}).label).toBe(label);
  expect(competitionPresentation({leagueId:772,homeTeamId:1,awayTeamId:2}).kind).toBe('logo');
 });

 it('uses self-contained SVG symbols and the shared logo bounds',async()=>{
  for(const file of ['3.svg','253.svg','10.svg']){
   const bytes=readFileSync(`render/assets/leagues/symbols/${file}`);
   const source=bytes.toString('utf8');
   expect(source).toMatch(/^<svg\s/);expect(source).toMatch(/fill="#fff"/i);
   expect(source).not.toMatch(/<\s*(script|image|foreignObject|filter|text)\b|\bhref\s*=|url\s*\(\s*["']?(?:https?:)?\/\//i);
   expect(await validateMatchImage(bytes)).toMatchObject({format:'svg'});
  }
  expect(competitionSymbolSize('uel')).toEqual({width:40,height:72});
  expect(competitionSymbolSize('mls')).toEqual({width:64,height:56});
  expect(competitionSymbolSize('friendly')).toEqual({width:56,height:56});
  expect(competitionSymbolSize('unknown')).toBeNull();
  expect(leagueLogoSize(999)).toEqual({width:72,height:56});
 });

 it('applies logo-only UEL and matching marker lines in every built-in template',()=>{
  for(const template of templates){
   const input=templateHtml(template);
   const uel=applyMatchPresentation(input,{leagueId:3,template,accents:{left:'linear-gradient(90deg, #a 0%, #b 100%)',right:'linear-gradient(270deg, #a 0%, #b 100%)'}});
   expect(uel).not.toContain('<span class="competition-label">UEL</span>');
   expect(uel).toContain('.league-logo.competition-symbol{filter:none;object-fit:contain;max-width:none;max-height:none}');
   if(template==='classic'||template==='panel')expect(uel).toContain('{{LEAGUE_LINE_LEFT}}');
   else {expect(uel).toContain('background:linear-gradient(90deg, #a 0%, #b 100%)');expect(uel).toContain('background:linear-gradient(270deg, #a 0%, #b 100%)');}
   const mls=applyMatchPresentation(input,{leagueId:253,homeTeamId:9568,template,accents:{left:'#fff',right:'#fff'}});
   expect(mls).not.toContain('competition-label');
   const friendly=applyMatchPresentation(input,{leagueId:10,homeTeamId:26,template,accents:{left:'#08f',right:'#08f'}});
   expect(friendly).not.toContain('competition-label');
   const fallback=applyMatchPresentation(input,{leagueId:9,homeTeamId:26,template,accents:{left:'#ca4',right:'#ca4'}});
   expect(fallback).toContain('<span class="competition-label">CA</span>');
  }
 });
});
