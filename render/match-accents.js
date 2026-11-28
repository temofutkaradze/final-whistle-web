'use strict';

const { LEAGUE_ACCENTS, leagueAccents } = require('./league-accents.js');

// Competition colors for the newly supported competitions. The shared
// leagueAccents helper remains unchanged because News standings also use it.
const MATCH_ACCENTS = Object.freeze({
  3: ['#f36b21', '#f58220', '#f7941d'],
  253: ['#fff'],
  10: ['#31a9e0', '#2674b8', '#3c5ba9'],
  1: ['#157d92', '#278d76', '#3a9d69'],
  34: ['#0f6f72', '#238b76', '#4b9b61'],
  9: ['#dfa62e', '#e98236', '#c84a3d'],
  772: ['#9bc63b', '#52a843', '#168b6e'],
  16: ['#20aab1', '#168c9c', '#176a88'],
  257: ['#c64445', '#df5b4d', '#e9a14f'],
  15: ['#c6a34d', '#d8bd66', '#eee0a2'],
});

function mirrorHorizontalGradient(value) {
  const match = /^linear-gradient\(\s*(90deg|to right)\s*,([\s\S]*)\)$/i.exec(value);
  if (!match) return value;
  const direction = match[1].toLowerCase() === '90deg' ? '270deg' : 'to left';
  return `linear-gradient(${direction},${match[2]})`;
}

function matchLeagueAccents(id, logo = '') {
  const explicit = id !== undefined && id !== null;
  const legacy = typeof logo === 'string' ? /\/leagues\/(\d+)(?:[./?#]|$)/.exec(logo) : null;
  const key = explicit ? (Number.isSafeInteger(id) && id > 0 ? id : null) : Number(legacy?.[1]);
  const colors = MATCH_ACCENTS[key];
  if (colors) {
    const left = colors.length === 1 ? colors[0] : `linear-gradient(90deg, ${colors.join(', ')})`;
    return { left, right: mirrorHorizontalGradient(left) };
  }
  const existing = leagueAccents(id, logo);
  return { left: existing.left, right: mirrorHorizontalGradient(existing.left) };
}

module.exports = { MATCH_ACCENTS, matchLeagueAccents, mirrorHorizontalGradient };
