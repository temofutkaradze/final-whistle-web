// API-Football league ids (same ids the n8n workflow already uses).
export const LEAGUES = [
  { id: 39, name: "Premier League" },
  { id: 140, name: "La Liga" },
  { id: 135, name: "Serie A" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 2, name: "UEFA Champions League" },
  { id: 5, name: "UEFA Nations League" },
] as const;

export function leagueName(id: number): string {
  return LEAGUES.find((l) => l.id === id)?.name ?? `League ${id}`;
}
