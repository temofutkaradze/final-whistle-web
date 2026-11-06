import { describe, expect, it } from "vitest";
import { fillPlaceholders, brandInnerHtml } from "@/lib/sample-match";
import {
  BRAND_SPOTS,
  DEFAULT_CONFIG,
  FONTS,
  FRAMES,
  LAYOUTS,
  LEAGUE_SPOTS,
  POSITIONS,
  PRESETS,
  SEPARATORS,
  SHADES,
  SIZES,
  buildTemplateHtml,
  normalizeConfig,
  type BuilderConfig,
} from "@/lib/template-builder";
import { previewDocument } from "../render/final-document.js";
import { checkTemplateHtml } from "../render/template-check.js";

// Every generated template must pass the safety check, fill completely and keep the layout block on the image.
function expectGood(cfg: BuilderConfig, label: string) {
  const html = buildTemplateHtml(cfg);
  const check = checkTemplateHtml(html);
  expect(check.errors, label).toEqual([]);
  expect(html, label).not.toMatch(/NaN|undefined|\[object/);
  const filled = fillPlaceholders(html, brandInnerHtml("Final Whistle", null));
  expect(filled, label).not.toMatch(/\{\{[A-Z_]+\}\}/);
  expect(previewDocument(filled), label).not.toBe("");
  const top = Number(html.match(/\.scoreboard \{[^}]*top: (\d+)px/)?.[1]);
  expect(top, label).toBeGreaterThanOrEqual(0);
  expect(top, label).toBeLessThanOrEqual(1350);
}

describe("template builder", () => {
  it("the default options make a valid template", () => expectGood(DEFAULT_CONFIG, "default"));

  it("every value of every option works (one option changed at a time)", () => {
    const sweep: [keyof BuilderConfig, readonly unknown[]][] = [
      ["layout", LAYOUTS],
      ["position", POSITIONS],
      ["offsetY", [-300, -10, 0, 10, 300]],
      ["font", Object.keys(FONTS)],
      ["textColor", ["#000000", "#ffffff", "#ffd400"]],
      ["scoreColor", ["#000000", "#e50914"]],
      ["accent", ["#000000", "#ffffff"]],
      ["scoreSize", SIZES],
      ["scoreSeparator", SEPARATORS],
      ["nameSize", SIZES],
      ["uppercaseNames", [true, false]],
      ["textShadow", [true, false]],
      ["logoSize", SIZES],
      ["shade", SHADES],
      ["shadeColor", ["#000000", "#0a1a3a"]],
      ["shadeOpacity", [0, 50, 100]],
      ["shadeBlur", [true, false]],
      ["vignette", [true, false]],
      ["bgBrightness", [30, 100, 130]],
      ["bgSaturate", [0, 100, 160]],
      ["bgBlur", [0, 10, 20]],
      ["frame", FRAMES],
      ["accentLine", [true, false]],
      ["showLeague", [true, false]],
      ["leagueSpot", LEAGUE_SPOTS],
      ["showNames", [true, false]],
      ["showEvents", [true, false]],
      ["eventsSize", SIZES],
      ["eventsDivider", [true, false]],
      ["brand", BRAND_SPOTS],
      ["brandSize", SIZES],
    ];
    // the sweep must cover every option, so a newly added option cannot be forgotten here
    expect(sweep.map(([k]) => k).sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort());
    for (const [key, values] of sweep) {
      for (const value of values) expectGood({ ...DEFAULT_CONFIG, [key]: value } as BuilderConfig, `${String(key)}=${String(value)}`);
    }
  });

  it("600 pseudo-random combinations work (fixed seed, so a failure can be repeated)", () => {
    let seed = 20261027;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
    const color = () => "#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0");
    for (let i = 0; i < 600; i++) {
      const cfg: BuilderConfig = {
        layout: pick(LAYOUTS), position: pick(POSITIONS), offsetY: Math.round(rnd() * 600 - 300), font: pick(Object.keys(FONTS) as BuilderConfig["font"][]),
        textColor: color(), scoreColor: color(), accent: color(), scoreSize: pick(SIZES), scoreSeparator: pick(SEPARATORS), nameSize: pick(SIZES),
        uppercaseNames: rnd() > 0.5, textShadow: rnd() > 0.5, logoSize: pick(SIZES), shade: pick(SHADES), shadeColor: color(),
        shadeOpacity: Math.round(rnd() * 100), shadeBlur: rnd() > 0.5, vignette: rnd() > 0.5, bgBrightness: 30 + Math.round(rnd() * 100),
        bgSaturate: Math.round(rnd() * 160), bgBlur: Math.round(rnd() * 20), frame: pick(FRAMES), accentLine: rnd() > 0.5, showLeague: rnd() > 0.5,
        leagueSpot: pick(LEAGUE_SPOTS), showNames: rnd() > 0.5, showEvents: rnd() > 0.5, eventsSize: pick(SIZES), eventsDivider: rnd() > 0.5,
        brand: pick(BRAND_SPOTS), brandSize: pick(SIZES),
      };
      expectGood(cfg, `random #${i}: ${JSON.stringify(cfg)}`);
    }
  });

  it("team names stay in the template (hidden) when switched off, so the placeholders are never missing", () => {
    const html = buildTemplateHtml({ ...DEFAULT_CONFIG, showNames: false });
    expect(html).toContain("{{HOME_NAME}}");
    expect(html).toContain("{{AWAY_NAME}}");
    expect(html).toContain('style="display: none"');
  });

  it("every preset is a valid, stable configuration", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const p of PRESETS) {
      const cfg = normalizeConfig({ ...DEFAULT_CONFIG, ...p.patch });
      expectGood(cfg, p.name);
      expect(normalizeConfig(cfg)).toEqual(cfg);
    }
  });
});

describe("normalizeConfig", () => {
  it("fills in defaults for anything missing, also for old saved configs", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig("nope")).toEqual(DEFAULT_CONFIG);
    const old = normalizeConfig({ font: "Oswald", textColor: "#ffd400", shade: "panel", position: "middle", brand: "top-right" });
    expect(old.font).toBe("Oswald");
    expect(old.scoreColor).toBe("#ffd400"); // an old config had one text colour for everything
    expect(old.layout).toBe("side");
  });

  it("forces hostile values back into the allowed ones", () => {
    const evil = normalizeConfig({
      font: "x;}</style><script>", textColor: "red;}</style><script>alert(1)</script>", accent: "#12345", shade: "evil", shadeOpacity: "9999",
      offsetY: "1e9", bgBlur: -5, bgBrightness: 0, scoreSeparator: "<script>", brand: "../..", showEvents: "yes", frame: { toString: () => "thick" },
    });
    expect(evil).toMatchObject({ font: "Montserrat", textColor: "#ffffff", accent: "#ffffff", shade: "gradient", shadeOpacity: 100, offsetY: 300, bgBlur: 0, bgBrightness: 30, scoreSeparator: "-", brand: "top-left", showEvents: true, frame: "none" });
    const html = buildTemplateHtml(evil);
    expect(html).not.toContain("<script");
    expect(checkTemplateHtml(html).ok).toBe(true);
  });

  it("keeps numbers inside their ranges and understands numeric strings", () => {
    expect(normalizeConfig({ offsetY: -99999 }).offsetY).toBe(-300);
    expect(normalizeConfig({ shadeOpacity: "42.4" }).shadeOpacity).toBe(42);
    expect(normalizeConfig({ bgSaturate: NaN }).bgSaturate).toBe(DEFAULT_CONFIG.bgSaturate);
  });
});
