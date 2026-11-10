import { validateTable, type StandingsTable, StandingsError } from './standings.ts';
export const footballDataCodes:Readonly<Record<number,string>>=Object.freeze({39:'PL',140:'PD',135:'SA',78:'BL1',61:'FL1'});
export type ApprovedRasterAssets={leagueLogo:string;teamCrests:Readonly<Record<string,string>>};
// Pure DTO mapping; HTTP and approved raster conversion live in football-data.ts.
export function mapFootballData(raw:unknown,leagueId:number,totalTeams:number,assets:ApprovedRasterAssets,now=Date.now()):StandingsTable{
  const data=raw as {competition?:{code?:string};season?:{startDate:string;endDate:string};standings?:{type:string;stage:string;group?:string|null;table:{position:number;team:{id:number;name:string};playedGames:number;goalDifference:number;points:number}[]}[]};
  const total=data?.standings?.filter(s=>s.type==='TOTAL'&&s.stage==='REGULAR_SEASON'&&(s.group==null||s.group==='Matchday'));
  if(!footballDataCodes[leagueId]||data?.competition?.code!==footballDataCodes[leagueId]||!data.season||total?.length!==1||!Array.isArray(total[0].table))throw new StandingsError('STANDINGS_DATA','The provider returned an ambiguous or incorrect league table.');
  return validateTable({leagueId,totalTeams,seasonStart:data.season.startDate,seasonEnd:data.season.endDate,source:'Football data provided by the Football-Data.org API',fetchedAt:now,leagueLogo:assets.leagueLogo,rows:total[0].table.map(r=>({position:r.position,teamId:String(r.team.id),name:r.team.name,played:r.playedGames,goalDifference:r.goalDifference,points:r.points,crest:assets.teamCrests[String(r.team.id)]}))},leagueId,now);
}
