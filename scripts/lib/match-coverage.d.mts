export const FEATURED_MATCH_TEAMS: readonly Readonly<{id:number;name:string}>[];
export const EUROPA_LEAGUE_ID: number;
export const INTER_MIAMI_COMPETITIONS: ReadonlySet<number>;
export const MATCH_COVERAGE_VERSION: string;
export function includesMatchFixture(fixture:{league:{id:number;name?:string};teams:{home:{id:number};away:{id:number}}},leagues:ReadonlySet<number>):boolean;
