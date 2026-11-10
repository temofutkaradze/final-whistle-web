export type ReferenceEvent = {
  type: string;
  detail: string;
  comments: string | null;
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
};
export type ReferenceScenario = {
  id: number; home: string; away: string; hs: number; as: number; league: number;
  events: ReferenceEvent[];
  match: {
    home_team: string; away_team: string; home_team_id: number; away_team_id: number;
    home_score: number; away_score: number;
  };
};
export const referenceScenarios: ReferenceScenario[];
