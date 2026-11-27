import { FONTS, LAYOUTS, SHADES, POSITIONS, SIZES, SEPARATORS, LEAGUE_SPOTS, BRAND_SPOTS, FRAMES, DEFAULT_CONFIG, type FontKey, type BuilderConfig } from "./config";

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
