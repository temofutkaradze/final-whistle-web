'use strict';

// API-Football IDs. Visual support does not assert subscription/data access.
function competitionLabel(id) {
  return id === 5 ? 'UNL' : id === 6 ? 'CAF' : null;
}

// Built-ins only; never transform untrusted/custom customer documents here.
function applyMatchPresentation(html, {leagueId, template}) {
  const targets = template === 'stripe'
    ? '.band,.teams-score,.scorers-section,.league-logo-wrapper'
    : '.scoreboard';
  let css = `${targets}{translate:0 40px}`;
  const label = competitionLabel(leagueId);
  if (label) {
    const existingLines = html.includes('class="league-line"');
    html = html.replace(/<img\b[^>]*class="league-logo(?: [^"]*)?"[^>]*>/,
      `<span class="competition-label">${label}</span>`);
    css += '.competition-label{font-size:32px;font-weight:900;line-height:1;letter-spacing:1px;color:#FFFFFF;white-space:nowrap}';
    css += '.league-line,.league-line:last-child{background:#FFFFFF;opacity:1}';
    // Frame/Stripe have no logo-side lines. Add them only for these text labels.
    if (!existingLines) css += '.league-logo-wrapper{position:relative}.league-logo-wrapper:before,.league-logo-wrapper:after{content:"";position:absolute;top:calc(50% - 1px);width:350px;height:2px;background:#FFFFFF}.league-logo-wrapper:before{right:calc(50% + 100px)}.league-logo-wrapper:after{left:calc(50% + 100px)}';
    // Stripe's existing absolute anchor must remain absolute.
    if (!existingLines && template === 'stripe') css += '.league-logo-wrapper{position:absolute}';
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

module.exports = {competitionLabel, applyMatchPresentation, fitMatchComposition};
