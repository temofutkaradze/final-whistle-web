import sharp from 'sharp';
import type { StandingsTable } from '../src/lib/news/standings';
export async function fictionalTable(leagueId=39,now=Date.now()):Promise<StandingsTable>{
  const logo=(await sharp({create:{width:80,height:80,channels:4,background:{r:220,g:180,b:45,alpha:1}}}).png().toBuffer()).toString('base64');
  const count=leagueId===2?36:20;
  return {leagueId,totalTeams:count,seasonStart:new Date(now-30*86400_000).toISOString().slice(0,10),seasonEnd:new Date(now+240*86400_000).toISOString().slice(0,10),fetchedAt:now,source:'FICTIONAL TEST DATA - NOT REAL STANDINGS',leagueLogo:logo,rows:Array.from({length:count},(_,i)=>({position:i+1,teamId:String(i+1),name:['Northbridge Athletic','Eastborough United','Riverside City','Westhaven Rovers'][i%4]+' '+(i+1),played:12,goalDifference:20-i*2,points:36-i,crest:logo}))};
}
