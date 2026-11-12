import {randomUUID} from 'node:crypto';
import {approvedMatchUser} from './match-pairing.mjs';
import {buildEventsHtml} from './events.mjs';

// Manual deliveries intentionally never update automatic status, attempts, sentAt or dispatch fences.
export async function regenerateAssignedMatches({prisma,userId,backgroundPath,fixtureId,scope,tg,renderPost,brandLookFields,isActive=()=>true}) {
  const selections=await prisma.selection.findMany({where:{userId,backgroundPath,status:{not:'DESELECTED'},...(fixtureId==='all'?{}:{fixtureId})},include:{match:true}});
  const result={sent:0,unavailable:0,failed:0};
  for(const sel of selections){
    if(!isActive()||!await approvedMatchUser(prisma,userId,scope))break;
    const match=sel.match;
    if(!Number.isInteger(match.homeScore)||!Number.isInteger(match.awayScore)||match.homeScore<0||match.awayScore<0){result.unavailable++;continue;}
    try{
      const brand=await prisma.brand.findFirst({where:{userId},orderBy:{createdAt:'desc'}});
      let custom={};
      if(brand?.templateRef?.startsWith('custom:')){
        const template=await prisma.template.findFirst({where:{id:brand.templateRef.slice(7),userId},select:{html:true}});
        custom=template?{template:'classic',template_html:template.html}:{template:'classic'};
      }
      const jpg=await renderPost({fixture_id:`manual_${match.fixtureId}_${randomUUID()}`,
        ...await brandLookFields(brand),...custom,background_path:backgroundPath,
        league_id:match.leagueId,league_logo:match.leagueLogo,home_logo:match.homeLogo,away_logo:match.awayLogo,
        home_team:match.homeTeam,away_team:match.awayTeam,home_score:match.homeScore,away_score:match.awayScore,
        ...buildEventsHtml(match.eventsJson??[],{home_team_id:match.homeTeamId,away_team_id:match.awayTeamId,home_team:match.homeTeam,away_team:match.awayTeam,home_score:match.homeScore,away_score:match.awayScore})});
      if(!isActive()||!await approvedMatchUser(prisma,userId,scope))break;
      await tg.sendDocument(scope.identity.chatId,jpg,`Manual regeneration — ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
      result.sent++;
    }catch{result.failed++;} // No automatic Telegram resend when delivery is ambiguous.
  }
  return result;
}
