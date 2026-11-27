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
