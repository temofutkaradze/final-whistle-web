export const reviewCases: {file:string; id:string; description:string; home:string; away:string; homeScore:number; awayScore:number; leagueId:number; events:unknown[]}[];
export function packageReview(source:string,destination:string):Promise<{destination:string;zip:string;images:number}>;
