'use strict';

// Samples from the supplied preview-league-colors.png line interiors, left to
// right on each side. These are reference pixels, not invented club palettes.
const LEAGUE_ACCENTS = Object.freeze(Object.fromEntries(Object.entries({
  140: ['#ff992e', '#ff7c34', '#ff5f3a', '#ff5e3a', '#ff4d44', '#ff3b4e'],
  39:  ['#6b2bff', '#8933fa', '#a63bf5', '#a63af3', '#c81ea4', '#e80154'],
  135: ['#1457f0', '#157fec', '#16a7e8', '#16a8e8', '#21c4ed', '#2ce0f2'],
  78:  ['#a90110', '#bd0312', '#d10515', '#d30616', '#e92028', '#fe3a3a'],
  61:  ['#305bff', '#5f59ff', '#8e57ff', '#9057ff', '#c753d1', '#fd4fa4'],
  2:   ['#35efd1', '#22b8ff', '#3c6cff', '#3f6bff', '#8a4dff', '#ee4de8'],
  5:   ['#1ebaaf', '#8bc86a', '#f6d324', '#f9d324', '#f58c2f', '#f0453b'],
}).map(([id, colors]) => [id, Object.freeze(colors)])));

const WHITE = 'rgba(255, 255, 255, 0.45)';
function leagueAccents(id, logo = '') {
  // Explicit API-Football league ID wins, including an unknown ID. Legacy
  // callers still work with an API logo URL; names never determine a palette.
  const explicit = id !== undefined && id !== null;
  const legacy = typeof logo === 'string' ? /\/leagues\/(\d+)(?:[./?#]|$)/.exec(logo) : null;
  const key = explicit ? (Number.isSafeInteger(id) && id > 0 ? id : null) : Number(legacy?.[1]);
  const colors = LEAGUE_ACCENTS[key];
  if (!colors) return { left: WHITE, right: WHITE };
  const gradient = values => `linear-gradient(90deg, ${values.join(', ')})`;
  return { left: gradient(colors.slice(0, 3)), right: gradient(colors.slice(3)) };
}

module.exports = { LEAGUE_ACCENTS, leagueAccents };
