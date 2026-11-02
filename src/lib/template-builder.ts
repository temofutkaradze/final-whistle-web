// The "build it here" template maker. A customer picks options (layout, font, colours, dark layer, background, sizes...);
// this file turns the options into a normal template (HTML + CSS with {{PLACEHOLDERS}}), the same kind the render server draws.
// Pure code (no Node APIs): the dashboard uses it in the browser for the live preview and on the server to save.
// Every value that reaches the HTML comes from a fixed list, a number clamped to a range or a strict #rrggbb check,
// so the result is always safe (and always passes render/template-check.js).

export const FONTS = {
  Montserrat: { family: "'Montserrat', sans-serif", url: "Montserrat:wght@600;800;900", w: [600, 800, 900] },
  Oswald: { family: "'Oswald', 'Arial Narrow', sans-serif", url: "Oswald:wght@500;600;700", w: [500, 600, 700] },
  "Barlow Condensed": { family: "'Barlow Condensed', 'Arial Narrow', sans-serif", url: "Barlow+Condensed:wght@600;700;800", w: [600, 700, 800] },
  "Bebas Neue": { family: "'Bebas Neue', 'Arial Narrow', sans-serif", url: "Bebas+Neue", w: [400, 400, 400] },
  Inter: { family: "'Inter', Arial, sans-serif", url: "Inter:wght@600;800;900", w: [600, 800, 900] },
  "Playfair Display": { family: "'Playfair Display', Georgia, serif", url: "Playfair+Display:wght@600;800;900", w: [600, 800, 900] },
  Anton: { family: "'Anton', 'Arial Narrow', sans-serif", url: "Anton", w: [400, 400, 400] },
  "Roboto Condensed": { family: "'Roboto Condensed', 'Arial Narrow', sans-serif", url: "Roboto+Condensed:wght@600;700;800", w: [600, 700, 800] },
} as const;
export type FontKey = keyof typeof FONTS;

export const LAYOUTS = ["side", "stacked"] as const;
export const SHADES = ["none", "gradient", "panel", "band", "card"] as const;
export const POSITIONS = ["upper", "middle", "lower"] as const;
export const SIZES = ["small", "medium", "large"] as const;
export const SEPARATORS = ["-", ":", "–", "|"] as const;
export const LEAGUE_SPOTS = ["above", "top-left", "top-center", "top-right"] as const;
export const BRAND_SPOTS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;
export const FRAMES = ["none", "thin", "thick"] as const;

export type BuilderConfig = {
  // arrangement
  layout: (typeof LAYOUTS)[number];
  position: (typeof POSITIONS)[number];
  offsetY: number; // -300..300, moves the whole block
  // text
  font: FontKey;
  textColor: string;
  scoreColor: string;
  accent: string;
  scoreSize: (typeof SIZES)[number];
  scoreSeparator: (typeof SEPARATORS)[number];
  nameSize: (typeof SIZES)[number];
  uppercaseNames: boolean;
  textShadow: boolean;
  logoSize: (typeof SIZES)[number];
  // dark layer
  shade: (typeof SHADES)[number];
  shadeColor: string;
  shadeOpacity: number; // 0..100
  shadeBlur: boolean;
  vignette: boolean;
  // background photo
  bgBrightness: number; // 30..130 (%)
  bgSaturate: number; // 0..160 (%)
  bgBlur: number; // 0..20 (px)
  // extras
  frame: (typeof FRAMES)[number];
  accentLine: boolean;
  // what to show
  showLeague: boolean;
  leagueSpot: (typeof LEAGUE_SPOTS)[number];
  showNames: boolean;
  showEvents: boolean;
  eventsSize: (typeof SIZES)[number];
  eventsDivider: boolean;
  // page name or logo
  brand: (typeof BRAND_SPOTS)[number];
  brandSize: (typeof SIZES)[number];
};

export const DEFAULT_CONFIG: BuilderConfig = {
  layout: "side",
  position: "lower",
  offsetY: 0,
  font: "Montserrat",
  textColor: "#ffffff",
  scoreColor: "#ffffff",
  accent: "#ffffff",
  scoreSize: "medium",
  scoreSeparator: "-",
  nameSize: "medium",
  uppercaseNames: true,
  textShadow: true,
  logoSize: "medium",
  shade: "gradient",
  shadeColor: "#000000",
  shadeOpacity: 85,
  shadeBlur: false,
  vignette: false,
  bgBrightness: 100,
  bgSaturate: 100,
  bgBlur: 0,
  frame: "none",
  accentLine: false,
  showLeague: true,
  leagueSpot: "above",
  showNames: true,
  showEvents: true,
  eventsSize: "medium",
  eventsDivider: false,
  brand: "top-left",
  brandSize: "medium",
};

// Starting points the customer can load in the builder and then change.
export const PRESETS: { name: string; patch: Partial<BuilderConfig> }[] = [
  { name: "Dark fade", patch: {} },
  { name: "Dark panel", patch: { shade: "panel", shadeOpacity: 92, shadeColor: "#0a0d12", font: "Barlow Condensed", scoreSize: "large", accent: "#ffffff" } },
  { name: "Glass card", patch: { shade: "card", shadeOpacity: 45, shadeBlur: true, position: "middle", layout: "stacked", font: "Inter", accentLine: true } },
  { name: "Poster", patch: { layout: "stacked", font: "Anton", scoreSize: "large", shade: "gradient", frame: "thick", uppercaseNames: true, position: "lower", vignette: true } },
  { name: "Clean frame", patch: { layout: "stacked", frame: "thin", font: "Montserrat", shade: "gradient", brand: "top-center", position: "lower", eventsDivider: true } },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

// Anything that comes from the browser (or from an older saved config) is forced back into the allowed values.
export function normalizeConfig(raw: unknown): BuilderConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  return {
    layout: pick(LAYOUTS, r.layout, d.layout),
    position: pick(POSITIONS, r.position, d.position),
    offsetY: num(r.offsetY, -300, 300, d.offsetY),
    font: pick(Object.keys(FONTS) as FontKey[], r.font, d.font),
    textColor: color(r.textColor, d.textColor),
    scoreColor: color(r.scoreColor, color(r.textColor, d.scoreColor)),
    accent: color(r.accent, d.accent),
    scoreSize: pick(SIZES, r.scoreSize, d.scoreSize),
    scoreSeparator: pick(SEPARATORS, r.scoreSeparator, d.scoreSeparator),
    nameSize: pick(SIZES, r.nameSize, d.nameSize),
    uppercaseNames: flag(r.uppercaseNames, d.uppercaseNames),
    textShadow: flag(r.textShadow, d.textShadow),
    logoSize: pick(SIZES, r.logoSize, d.logoSize),
    shade: pick(SHADES, r.shade, d.shade),
    shadeColor: color(r.shadeColor, d.shadeColor),
    shadeOpacity: num(r.shadeOpacity, 0, 100, d.shadeOpacity),
    shadeBlur: flag(r.shadeBlur, d.shadeBlur),
    vignette: flag(r.vignette, d.vignette),
    bgBrightness: num(r.bgBrightness, 30, 130, d.bgBrightness),
    bgSaturate: num(r.bgSaturate, 0, 160, d.bgSaturate),
    bgBlur: num(r.bgBlur, 0, 20, d.bgBlur),
    frame: pick(FRAMES, r.frame, d.frame),
    accentLine: flag(r.accentLine, d.accentLine),
    showLeague: flag(r.showLeague, d.showLeague),
    leagueSpot: pick(LEAGUE_SPOTS, r.leagueSpot, d.leagueSpot),
    showNames: flag(r.showNames, d.showNames),
    showEvents: flag(r.showEvents, d.showEvents),
    eventsSize: pick(SIZES, r.eventsSize, d.eventsSize),
    eventsDivider: flag(r.eventsDivider, d.eventsDivider),
    brand: pick(BRAND_SPOTS, r.brand, d.brand),
    brandSize: pick(SIZES, r.brandSize, d.brandSize),
  };
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.min(1, Math.max(0, alpha)).toFixed(2)})`;
};

const SCORE_PX = { small: 130, medium: 170, large: 210 } as const;
const LOGO_PX = { small: 120, medium: 170, large: 220 } as const;
const NAME_PX = { small: 26, medium: 32, large: 40 } as const;
const EVENT_PX = { small: 20, medium: 24, large: 28 } as const;
const BRAND_PX = { small: 26, medium: 34, large: 46 } as const;
const BRAND_LOGO_H = { small: 70, medium: 90, large: 130 } as const;
const BRAND_LOGO_W = { small: 220, medium: 300, large: 420 } as const;
const BRAND_RESERVE = { small: 70, medium: 100, large: 150 } as const;

function eventsCss(evPx: number, maxH: number) {
  return `
        .team-scorers { display: flex; flex-direction: column; gap: 12px; width: 100%; min-height: 20px; max-height: ${maxH}px; overflow: hidden; }
        .team-scorers.left { align-items: flex-end; text-align: right; }
        .team-scorers.right { align-items: flex-start; text-align: left; }
        .event { display: flex; align-items: center; min-height: ${Math.round(evPx * 1.25)}px; color: var(--text); font-size: ${evPx}px; font-weight: var(--w2); line-height: 1.15; white-space: nowrap; text-shadow: var(--tshadow); }
        .team-scorers.left .event { justify-content: flex-end; }
        .team-scorers.right .event { justify-content: flex-start; }
        .player-name { display: inline-block; max-width: 280px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
        .minute { font-size: ${Math.round(evPx * 0.85)}px; opacity: .9; }
        .sep { display: inline-block; margin: 0 10px; opacity: .55; font-weight: 600; }
        .pk-wrap { display: inline-flex; align-items: center; justify-content: center; margin: 0 6px; flex-shrink: 0; }
        .pk-wrap svg { display: block; }
        .goal-icon { display: inline-flex; align-items: center; justify-content: center; margin: 0 8px; font-size: ${Math.round(evPx * 0.96)}px; line-height: 1; }
        .card-icon { position: relative; display: inline-block; width: 14px; height: 20px; margin: 0 9px; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,.5); flex-shrink: 0; }
        .card-icon.yellow { background: #ffd400; }
        .card-icon.red { background: #e50914; }
        .card-icon.second-yellow { width: 19px; height: 24px; background: transparent; box-shadow: none; }
        .card-icon.second-yellow::before, .card-icon.second-yellow::after { content: ""; position: absolute; width: 14px; height: 20px; border-radius: 2px; }
        .card-icon.second-yellow::before { left: 5px; top: 4px; background: #ffd400; box-shadow: 0 2px 5px rgba(0,0,0,.5); }
        .card-icon.second-yellow::after { left: 0; top: 0; background: #e50914; box-shadow: 0 2px 5px rgba(0,0,0,.55); }`;
}

export function buildTemplateHtml(input: BuilderConfig): string {
  const c = normalizeConfig(input);
  const font = FONTS[c.font];
  const [w1, w2, w3] = font.w;
  const scorePx = SCORE_PX[c.scoreSize];
  const logoPx = LOGO_PX[c.logoSize];
  const namePx = NAME_PX[c.nameSize];
  const evPx = EVENT_PX[c.eventsSize];

  // ---- vertical layout of the block (all numbers are pixels of the 1080x1350 image) ----
  const leagueAbove = c.showLeague && c.leagueSpot === "above";
  const leagueH = leagueAbove ? 100 : 0;
  const nameBlock = c.showNames ? Math.round(namePx * 2.2) + 12 : 0;
  const stackedTeamsH = 110;
  const teamsH = c.layout === "side" ? Math.max(logoPx + nameBlock, scorePx) : scorePx + 10 + stackedTeamsH;
  const lineH = c.accentLine ? 28 : 0;
  const evRow = Math.round(evPx * 1.3 + 12);
  const eventsMax = evRow * 5;
  const eventsH = c.showEvents ? 30 + eventsMax : 0;
  const blockH = leagueH + teamsH + lineH + eventsH;

  const brandTop = c.brand.startsWith("top");
  const reserve = BRAND_RESERVE[c.brandSize];
  let top: number;
  if (c.position === "lower") top = 1350 - 50 - blockH - (brandTop ? 0 : reserve);
  else if (c.position === "middle") top = Math.round((1350 - blockH) / 2);
  else top = 60 + (brandTop ? reserve : 0);
  top = Math.min(Math.max(0, top + c.offsetY), Math.max(0, 1350 - blockH));

  // ---- layers ----
  const alpha = c.shadeOpacity / 100;
  const blur = c.shadeBlur ? " backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);" : "";
  let shadeHtml = "";
  let shadeCss = "";
  if (c.shade === "gradient") {
    const dir = c.position === "upper" ? "to bottom" : "to top";
    const stops =
      c.position === "middle"
        ? `${rgba(c.shadeColor, alpha * 0.6)} 0%, ${rgba(c.shadeColor, alpha * 0.6)} 100%`
        : `${rgba(c.shadeColor, alpha)} 0%, ${rgba(c.shadeColor, alpha * 0.55)} 45%, ${rgba(c.shadeColor, 0)} 85%`;
    shadeCss = `.shade { position: absolute; inset: 0; z-index: 2; background: linear-gradient(${dir}, ${stops}); }`;
    shadeHtml = `<div class="shade"></div>`;
  } else if (c.shade === "panel") {
    shadeCss = `.shade { position: absolute; left: 0; right: 0; top: ${Math.max(0, top - 36)}px; height: ${blockH + 72}px; z-index: 2; background: ${rgba(c.shadeColor, alpha)}; border-top: 3px solid ${c.accent}; border-bottom: 3px solid ${c.accent};${blur} }`;
    shadeHtml = `<div class="shade"></div>`;
  } else if (c.shade === "band") {
    shadeCss = `.shade { position: absolute; left: 0; right: 0; top: ${Math.max(0, top + leagueH - 20)}px; height: ${teamsH + 40}px; z-index: 2; background: ${rgba(c.shadeColor, alpha)}; border-top: 3px solid ${c.accent}; border-bottom: 3px solid ${c.accent};${blur} }`;
    shadeHtml = `<div class="shade"></div>`;
  } else if (c.shade === "card") {
    shadeCss = `.shade { position: absolute; left: 40px; right: 40px; top: ${Math.max(0, top - 40)}px; height: ${blockH + 80}px; z-index: 2; border-radius: 28px; background: ${rgba(c.shadeColor, alpha)}; border: 2px solid ${rgba(c.accent, 0.55)};${blur} }`;
    shadeHtml = `<div class="shade"></div>`;
  }
  const vignetteHtml = c.vignette ? `<div class="vignette"></div>` : "";
  const frameInset = c.frame === "thick" ? 24 : 28;
  const frameHtml = c.frame === "none" ? "" : `<div class="frame"></div>`;
  const bgFilter = `brightness(${c.bgBrightness}%) saturate(${c.bgSaturate}%)${c.bgBlur ? ` blur(${c.bgBlur}px)` : ""}`;

  // ---- page name / logo and league logo corners ----
  // With a frame around the post, the corner items move inside it.
  const fo = c.frame === "thick" ? 36 : c.frame === "thin" ? 14 : 0;
  const [vert, horiz] = c.brand.split("-");
  const brandCss =
    `.branding { position: absolute; z-index: 6; ${vert}: ${28 + fo}px; ` +
    (horiz === "left" ? `left: ${36 + fo}px; text-align: left; ` : horiz === "right" ? `right: ${36 + fo}px; text-align: right; ` : "left: 50%; transform: translateX(-50%); text-align: center; ") +
    `width: max-content; max-width: 420px; color: var(--text); font-size: ${BRAND_PX[c.brandSize]}px; font-weight: var(--w3); line-height: 1; letter-spacing: 1px; text-transform: uppercase; white-space: pre-line; text-shadow: var(--tshadow); --brand-logo-h: ${BRAND_LOGO_H[c.brandSize]}px; --brand-logo-w: ${BRAND_LOGO_W[c.brandSize]}px; }\n` +
    `        .brand-logo { display: block; ${horiz === "center" ? "margin: 0 auto;" : horiz === "right" ? "margin-left: auto;" : ""} }`;

  const leagueImg = `<img class="league-logo" src="{{LEAGUE_LOGO}}" alt="">`;
  let leagueBlock = "";
  let leagueCss = "";
  if (c.showLeague && leagueAbove) {
    leagueBlock = `<div class="league-logo-wrapper">${leagueImg}</div>`;
    leagueCss = `.league-logo-wrapper { display: flex; align-items: center; justify-content: center; height: ${leagueH}px; }`;
  } else if (c.showLeague) {
    const lh = c.leagueSpot.split("-")[1];
    leagueBlock = `<div class="league-corner">${leagueImg}</div>`;
    leagueCss = `.league-corner { position: absolute; z-index: 6; top: ${28 + fo}px; ${lh === "left" ? `left: ${36 + fo}px;` : lh === "right" ? `right: ${36 + fo}px;` : "left: 50%; transform: translateX(-50%);"} }`;
  }

  // ---- teams and score ----
  const sep = c.scoreSeparator;
  const score = `<div class="score-text">{{HOME_SCORE}}${sep}{{AWAY_SCORE}}</div>`;
  // Hidden (not left out) when switched off, so the template still contains the {{HOME_NAME}} / {{AWAY_NAME}} placeholders.
  const nameEl = (n: string) => `<div class="team-name"${c.showNames ? "" : ' style="display: none"'}>${n}</div>`;
  let teamsHtml: string;
  let teamsCss: string;
  if (c.layout === "side") {
    teamsHtml = `<div class="teams-score">
            <div class="team"><img class="team-logo" src="{{HOME_LOGO}}" alt="">${nameEl("{{HOME_NAME}}")}</div>
            ${score}
            <div class="team"><img class="team-logo" src="{{AWAY_LOGO}}" alt="">${nameEl("{{AWAY_NAME}}")}</div>
        </div>`;
    teamsCss = `.teams-score { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; height: ${teamsH}px; }
        .team { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; }
        .team-logo { width: ${logoPx}px; height: ${logoPx}px; object-fit: contain; filter: drop-shadow(0 5px 10px rgba(0,0,0,.65)); }
        .team-name { margin-top: 12px; width: 280px; color: var(--text); font-size: ${namePx}px; font-weight: var(--w2); line-height: 1.1; text-align: center; text-transform: var(--upper); text-shadow: var(--tshadow); }`;
  } else {
    teamsHtml = `<div class="stack-score">${score}</div>
        <div class="teams-row">
            <div class="team-inline home">${nameEl("{{HOME_NAME}}")}<img class="team-logo" src="{{HOME_LOGO}}" alt=""></div>
            <div class="team-inline away"><img class="team-logo" src="{{AWAY_LOGO}}" alt="">${nameEl("{{AWAY_NAME}}")}</div>
        </div>`;
    teamsCss = `.stack-score { height: ${scorePx + 10}px; display: flex; align-items: center; justify-content: center; }
        .teams-row { display: flex; justify-content: space-between; align-items: center; height: ${stackedTeamsH}px; }
        .team-inline { display: flex; align-items: center; gap: 20px; width: 440px; min-width: 0; }
        .team-inline.home { justify-content: flex-end; text-align: right; }
        .team-inline.away { justify-content: flex-start; text-align: left; }
        .team-logo { width: 96px; height: 96px; flex: none; object-fit: contain; filter: drop-shadow(0 5px 10px rgba(0,0,0,.65)); }
        .team-name { max-width: 300px; color: var(--text); font-size: ${Math.min(namePx, 34)}px; font-weight: var(--w2); line-height: 1.1; text-transform: var(--upper); text-shadow: var(--tshadow); }`;
  }

  const lineHtml = c.accentLine ? `<div class="accent-line"></div>` : "";
  const eventsHtml = c.showEvents
    ? `<div class="scorers-section${c.eventsDivider ? " divided" : ""}">
            <div class="team-scorers left">{{HOME_EVENTS}}</div>
            <div class="team-scorers right">{{AWAY_EVENTS}}</div>
        </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1080, height=1350, initial-scale=1.0">
    <title>Custom template</title>
    <link href="https://fonts.googleapis.com/css2?family=${font.url}&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --text: ${c.textColor}; --score: ${c.scoreColor}; --accent: ${c.accent}; --w1: ${w1}; --w2: ${w2}; --w3: ${w3}; --upper: ${c.uppercaseNames ? "uppercase" : "none"}; --tshadow: ${c.textShadow ? "0 3px 8px rgba(0,0,0,.7)" : "none"}; }
        html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; font-family: ${font.family}; }
        .template-container { position: relative; width: 1080px; height: 1350px; overflow: hidden; background: #000; }
        .bg-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1; filter: ${bgFilter};${c.bgBlur ? " transform: scale(1.06);" : ""} }
        .vignette { position: absolute; inset: 0; z-index: 2; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.6) 100%); }
        .frame { position: absolute; inset: ${frameInset}px; z-index: 4; border: ${c.frame === "thick" ? 8 : 2}px solid ${c.accent}; pointer-events: none; }
        ${shadeCss}
        ${brandCss}
        ${leagueCss}
        .league-logo { max-width: 100px; max-height: 80px; object-fit: contain; filter: brightness(0) invert(1) drop-shadow(0 3px 5px rgba(0,0,0,.5)); }
        .league-logo.no-filter { filter: drop-shadow(0 3px 5px rgba(0,0,0,.5)); }
        .scoreboard { position: absolute; left: 50%; top: ${top}px; transform: translateX(-50%); width: 940px; z-index: 5; }
        ${teamsCss}
        .score-text { padding: 0 20px; color: var(--score); font-size: ${scorePx}px; font-weight: var(--w3); line-height: 1; white-space: nowrap; text-align: center; text-shadow: 0 5px 15px rgba(0,0,0,${c.textShadow ? ".75" : "0"}); }
        .accent-line { width: 140px; height: 4px; margin: 14px auto 10px; background: var(--accent); border-radius: 2px; }
        .scorers-section { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 90px; margin-top: 30px; }
        .scorers-section.divided::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: var(--accent); opacity: .6; }${eventsCss(evPx, eventsMax)}
    </style>
</head>
<body>
<div class="template-container">
    <img class="bg-image" src="{{BACKGROUND}}" alt="">
    ${vignetteHtml}
    ${shadeHtml}
    ${frameHtml}
    <div class="branding">{{PAGE_NAME}}</div>
    ${leagueBlock}
    <div class="scoreboard">
        ${teamsHtml}
        ${lineHtml}
        ${eventsHtml}
    </div>
</div>
</body>
</html>
`;
}
