// UEFA abbreviated names verified against the live 2026/27 table on 2026-11-11.
// football-data.org IDs identify clubs; these labels establish tie display order only.
// Sources: https://www.uefa.com/uefachampionsleague/standings/ and Article 18.
// Never sort or renumber provider data. Unknown/ambiguous tied names fail closed.
export const UEFA_ABBREVIATIONS:Readonly<Record<string,string>>=Object.freeze({
  '524':'Paris','86':'Real Madrid','57':'Arsenal','7397':'Como','81':'Barcelona',
  '58':'Aston Villa','65':'Man City','64':'Liverpool','851':'Club Brugge',
  '498':'Sporting CP','90':'Real Betis','4':'B. Dortmund','5':'Bayern M\u00fcnchen',
  '10':'Stuttgart','108':'Inter','2016':'LASK','66':'Man Utd','610':'Galatasaray',
  '613':'Fenerbah\u00e7e','100':'Roma','1887':'Shakhtar','5720':'Viking','78':'Atleti',
  '674':'PSV','5721':'Bod\u00f8/Glimt','503':'Porto','113':'Napoli','94':'Villarreal',
  '1899':'AEK Athens','721':'Leipzig','10233':'Sabah','675':'Feyenoord',
  '546':'Lens','930':'Slavia Praha','521':'Lille','7509':'S. Bratislava',
});
const alphabetical=new Intl.Collator('en',{sensitivity:'base'});
export function uclOrderProblem(rows:ReadonlyArray<{position:number;teamId:string;displayRow?:number}>,seasonStart:string):string|null{
  let previous=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(row.displayRow!==i+1||!Number.isSafeInteger(row.position)||row.position<1||row.position>36)return 'Invalid UCL display-row metadata';
    // Standard competition ranking: 28,29,29,31; not 28,29,29,30 or shuffled ranks.
    if(row.position!==previous&&row.position!==i+1)return 'UCL provider rank sequence is inconsistent with display rows';
    if(row.position===previous){
      if(!seasonStart.startsWith('2026-'))return 'UEFA tied-name ordering needs review for this season';
      const a=Object.hasOwn(UEFA_ABBREVIATIONS,rows[i-1].teamId)?UEFA_ABBREVIATIONS[rows[i-1].teamId]:undefined;
      const b=Object.hasOwn(UEFA_ABBREVIATIONS,row.teamId)?UEFA_ABBREVIATIONS[row.teamId]:undefined;
      if(!a||!b||alphabetical.compare(a,b)>=0)return 'UCL tied-row order cannot be verified against UEFA abbreviated names';
    }
    previous=row.position;
  }
  return null;
}
