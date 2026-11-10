import {leagueAccents} from "../../render/league-accents.js";
import {expandPlaceholders} from "../../render/final-document.js";
// Pure helpers (no Node APIs, safe to import in the browser): the invented sample match used for sample posts and
// template previews, and the way a template's {{PLACEHOLDERS}} are filled.

// ---------------------------------------------------------------------------
// Helpers for the sample match (everything is invented: no real clubs or logos)
// ---------------------------------------------------------------------------

function svgUri(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function teamBadge(letter: string, color: string): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">` +
      `<circle cx="75" cy="75" r="68" fill="${color}" stroke="#ffffff" stroke-width="6"/>` +
      `<text x="75" y="102" font-family="Arial, sans-serif" font-size="80" font-weight="700" ` +
      `text-anchor="middle" fill="#ffffff">${letter}</text></svg>`,
  );
}

// The template turns league logos into a white silhouette, so this is just a plain ring + letter.
const SAMPLE_LEAGUE_LOGO = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">` +
    `<circle cx="75" cy="75" r="62" fill="none" stroke="#000000" stroke-width="10"/>` +
    `<text x="75" y="100" font-family="Arial, sans-serif" font-size="70" font-weight="700" ` +
    `text-anchor="middle" fill="#000000">L</text></svg>`,
);

// Used when the customer has not set a background image.
export const DEFAULT_BACKGROUND = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1b7a4f"/><stop offset="1" stop-color="#07241a"/>` +
    `</linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/></svg>`,
);

const homeEvent = (minute: string, name: string) =>
  `<div class="event"><span class="minute">${minute}'</span><span class="sep">|</span><span class="player-name">${name}</span></div>`;
const awayEvent = (minute: string, name: string) =>
  `<div class="event"><span class="player-name">${name}</span><span class="sep">|</span><span class="minute">${minute}'</span></div>`;

// The template shows the page name one word per line (like "day / on / football").
export function pageNameForImage(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.slice(0, 16))
    .join("\n");
}


// The invented sample match. Used by the sample post and by the template previews on the dashboard.
export function sampleMatchFields() {
  return {
    league_logo: SAMPLE_LEAGUE_LOGO,
    home_logo: teamBadge("A", "#1b7a4f"),
    away_logo: teamBadge("B", "#24407a"),
    home_team: "FC Alpha",
    away_team: "FC Beta",
    home_score: 2,
    away_score: 1,
    total_events: 3,
    home_events_html: homeEvent("12", "J. Sample") + homeEvent("67", "K. Demo"),
    away_events_html: awayEvent("81", "L. Test"),
    background_data_uri: DEFAULT_BACKGROUND,
  };
}


function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// What {{PAGE_NAME}} becomes: the page name, or the logo as a small <img> (same markup as the render server).
export function brandInnerHtml(name: string, logoUri: string | null): string {
  if (logoUri) {
    return `<img class="brand-logo" src="${logoUri}" alt="" style="max-height:var(--brand-logo-h,90px);max-width:var(--brand-logo-w,300px);width:auto;height:auto;object-fit:contain;">`;
  }
  return escapeHtml(pageNameForImage(name).slice(0, 80));
}

// A template filled with the invented sample match (for previews; shown in a sandboxed iframe, so no script can run).
export function fillPlaceholders(html: string, brandHtml: string): string {
  const s = sampleMatchFields();
  const values: Record<string, string | number> = {
    "{{BACKGROUND}}": s.background_data_uri,
    "{{PAGE_NAME}}": brandHtml,
    "{{EVENTS_CLASS}}": "",
    "{{TOTAL_EVENTS}}": s.total_events,
    "{{LEAGUE_LINE_LEFT}}": leagueAccents().left,
    "{{LEAGUE_LINE_RIGHT}}": leagueAccents().right,
    "{{LEAGUE_LOGO}}": s.league_logo,
    "{{HOME_LOGO}}": s.home_logo,
    "{{HOME_NAME}}": s.home_team,
    "{{HOME_SCORE}}": s.home_score,
    "{{AWAY_SCORE}}": s.away_score,
    "{{AWAY_LOGO}}": s.away_logo,
    "{{AWAY_NAME}}": s.away_team,
    "{{HOME_EVENTS}}": s.home_events_html,
    "{{AWAY_EVENTS}}": s.away_events_html,
  };
  return expandPlaceholders(html,values);
}
