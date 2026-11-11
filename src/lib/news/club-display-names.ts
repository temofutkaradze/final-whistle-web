// Artwork labels only. football-data.org IDs, never API-Football IDs.
// Reviewed against authenticated current /v4/competitions/{code}/teams inventories
// for PL/PD/SA/BL1/FL1/CL on 2026-11-11. Provider names remain untouched.
// English editorial labels override provider shortName where requested (e.g. Inter).
export const CLUB_DISPLAY_NAMES:Readonly<Record<string,string>>=Object.freeze({
  '1':'Cologne','2':'Hoffenheim','3':'Leverkusen','4':'Dortmund','5':'Bayern Munich',
  '6':'Schalke','7':'Hamburg','10':'Stuttgart','12':'Werder Bremen','15':'Mainz',
  '16':'Augsburg','17':'Freiburg','18':'Mönchengladbach','19':'Eintracht Frankfurt',
  '28':'Union Berlin','29':'Paderborn',
  '57':'Arsenal','58':'Aston Villa','61':'Chelsea','62':'Everton','63':'Fulham',
  '64':'Liverpool','65':'Man City','66':'Man United','67':'Newcastle',
  '71':'Sunderland','73':'Tottenham','76':'Wolves',
  '77':'Athletic Club','78':'Atletico M.','79':'Osasuna','80':'Espanyol',
  '81':'Barcelona','82':'Getafe','84':'Malaga','86':'Real Madrid',
  '87':'Rayo Vallecano','88':'Levante','90':'Real Betis','92':'Real Sociedad',
  '94':'Villarreal','95':'Valencia',
  '98':'AC Milan','99':'Fiorentina','100':'Roma','102':'Atalanta','103':'Bologna',
  '104':'Cagliari','107':'Genoa','108':'Inter Milan','109':'Juventus','110':'Lazio',
  '112':'Parma','113':'Napoli','115':'Udinese',
  '263':'Alaves','285':'Elche','322':'Hull City','341':'Leeds United',
  '349':'Ipswich Town','351':'Nottingham Forest','354':'Crystal Palace',
  '397':'Brighton','402':'Brentford','454':'Venezia','470':'Frosinone',
  '471':'Sassuolo','498':'Sporting CP','503':'Porto','511':'Toulouse',
  '512':'Brest','516':'Marseille','519':'Auxerre','521':'Lille','522':'Nice',
  '523':'Lyon','524':'PSG','525':'Lorient','529':'Rennes','531':'Troyes',
  '532':'Angers','533':'Le Havre','535':'Le Mans','546':'Lens','548':'Monaco',
  '558':'Celta Vigo','559':'Sevilla','560':'Deportivo La Coruna','576':'Strasbourg',
  '586':'Torino','610':'Galatasaray','613':'Fenerbahce','674':'PSV',
  '675':'Feyenoord','719':'Elversberg','721':'RB Leipzig','851':'Club Brugge',
  '930':'Slavia Prague','1044':'Bournemouth','1045':'Paris FC','1076':'Coventry City',
  '1887':'Shakhtar Donetsk','1899':'AEK Athens','2016':'LASK',
  '5335':'Racing Santander','5720':'Viking','5721':'Bodo/Glimt','5890':'Lecce',
  '5911':'Monza','7397':'Como','7509':'Slovan Bratislava','10233':'Sabah',
});

export function clubDisplayName(team:{teamId:string;name:string}):{name:string;needsReview:boolean}{
  const known=Object.hasOwn(CLUB_DISPLAY_NAMES,team.teamId);
  // Preserve an unknown club's complete original name, including meaningful
  // prefixes. Rendering fits it without inventing a nickname or abbreviation.
  return {name:known?CLUB_DISPLAY_NAMES[team.teamId]:team.name,needsReview:!known};
}

export function displayNameCollisions(entries:Readonly<Record<string,string>>=CLUB_DISPLAY_NAMES):string[][]{
  const groups=new Map<string,string[]>();
  for(const [id,name] of Object.entries(entries)){
    const key=name.normalize('NFKC').trim().toLocaleLowerCase('en');
    groups.set(key,[...(groups.get(key)??[]),id]);
  }
  return [...groups.values()].filter(ids=>ids.length>1);
}
