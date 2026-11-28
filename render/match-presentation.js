'use strict';

// API-Football IDs. Visual support does not assert subscription/data access.
function competitionLabel(id) {
  return id === 5 ? 'UNL' : id === 6 ? 'CAF' : id === 3 ? 'UEL' : null;
}

const NATIONAL_TEAMS = new Set([26, 6]);
const INTER_MIAMI = 9568;
const COMPETITION_SYMBOLS = Object.freeze({ uel: '3.svg', mls: '253.svg', friendly: '10.svg' });
const COMPETITION_SYMBOL_SIZES = Object.freeze({
  // Optical boxes account for each symbol's natural silhouette, not transparent padding.
  uel: Object.freeze({ width: 40, height: 72 }),
  mls: Object.freeze({ width: 64, height: 56 }),
  friendly: Object.freeze({ width: 56, height: 56 }),
});

function competitionSymbolSize(key) {
  return COMPETITION_SYMBOL_SIZES[key] ?? null;
}

function competitionPresentation({ leagueId, homeTeamId, awayTeamId } = {}) {
  const id = Number.isSafeInteger(leagueId) ? leagueId : null;
  const teams = [homeTeamId, awayTeamId].filter(Number.isSafeInteger);
  const hasNationalTeam = teams.some(teamId => NATIONAL_TEAMS.has(teamId));
  const hasInterMiami = teams.includes(INTER_MIAMI);

  if (id === 3) return { kind: 'symbol', asset: COMPETITION_SYMBOLS.uel, key: 'uel' };
  if (id === 253 && hasInterMiami) return { kind: 'symbol', asset: COMPETITION_SYMBOLS.mls, key: 'mls' };
  if (id === 10 && hasNationalTeam) return { kind: 'symbol', asset: COMPETITION_SYMBOLS.friendly, key: 'friendly' };

  // Keep all established competition labels ahead of the new-team fallbacks.
  const established = competitionLabel(id);
  if (established && id !== 3) return { kind: 'label', label: established, established: true };

  if (hasNationalTeam) {
    const label = ({ 1: 'WC', 34: 'WCQ', 9: 'CA' })[id];
    if (label) return { kind: 'label', label };
  }
  if (hasInterMiami) {
    const label = ({ 772: 'LC', 16: 'CCC', 257: 'USOC', 15: 'CWC' })[id];
    if (label) return { kind: 'label', label };
  }
  return { kind: 'logo' };
}

// Built-ins only; never transform untrusted/custom customer documents here.
function applyMatchPresentation(html, {leagueId, homeTeamId, awayTeamId, template, accents}) {
  const targets = template === 'stripe'
    ? '.band,.teams-score,.scorers-section,.league-logo-wrapper'
    : '.scoreboard';
  let css = `${targets}{translate:0 40px}`;
  const marker = competitionPresentation({ leagueId, homeTeamId, awayTeamId });
  const label = marker.kind === 'label' ? marker.label : null;
  if (marker.kind === 'symbol') css += '.league-logo.competition-symbol{filter:none;object-fit:contain;max-width:none;max-height:none}';
  if (label) {
    html = html.replace(/<img\b[^>]*class="league-logo(?: [^"]*)?"[^>]*>/,
      `<span class="competition-label">${label}</span>`);
    css += '.competition-label{font-size:32px;font-weight:900;line-height:1;letter-spacing:1px;color:#FFFFFF;white-space:nowrap}';
    // Existing Nations League and CAF labels intentionally kept their white lines.
    if (marker.established) css += '.league-line,.league-line:last-child{background:#FFFFFF;opacity:1}';
  }
  // Classic/Panel already contain lines. Frame/Stripe use the same marker and
  // receive matching competition lines without changing their anchor geometry.
  if (!html.includes('class="league-line"')) {
    const left = accents?.left ?? 'rgba(255, 255, 255, 0.45)';
    const right = marker.established ? '#FFFFFF' : (accents?.right ?? left);
    css += `.league-logo-wrapper{position:relative}.league-logo-wrapper:before,.league-logo-wrapper:after{content:"";position:absolute;top:calc(50% - 1px);width:350px;height:2px}`;
    css += `.league-logo-wrapper:before{right:calc(50% + 100px);background:${left}}.league-logo-wrapper:after{left:calc(50% + 100px);background:${right}}`;
    // Stripe's existing absolute anchor must remain absolute.
    if (template === 'stripe') css += '.league-logo-wrapper{position:absolute}';
  }
  return html.replace('</head>', `<style>${css}</style></head>`);
}

// Called after fonts/images settle, before capture. Keep the composition together;
// dense results can use less downward movement (or move up) to preserve clearance.
async function fitMatchComposition(page, template) {
  return page.evaluate(stripe => {
    const targets = [...document.querySelectorAll(stripe
      ? '.band,.teams-score,.scorers-section,.league-logo-wrapper' : '.scoreboard')];
    const content = [...document.querySelectorAll('.score-text,.team-logo,.league-logo-wrapper,.event')];
    if (!targets.length || !content.length) return 0;
    const limit = stripe ? Math.min(1320, (document.querySelector('.branding')?.getBoundingClientRect().top ?? 1344) - 24) : 1320;
    const bottom = Math.max(...content.map(e => e.getBoundingClientRect().bottom));
    const current = parseFloat(getComputedStyle(targets[0]).translate.split(' ')[1]) || 0;
    const offset = current - Math.max(0, bottom - limit);
    for (const target of targets) target.style.translate = `0 ${offset}px`;
    if (content.some(e => e.getBoundingClientRect().top < 80)) throw Error('Match composition cannot fit safely');
    return offset;
  }, template === 'stripe');
}

module.exports = {competitionLabel, competitionPresentation, competitionSymbolSize, applyMatchPresentation, fitMatchComposition};
