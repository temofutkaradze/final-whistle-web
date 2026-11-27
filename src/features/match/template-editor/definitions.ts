import { BRAND_SPOTS, FONTS, FRAMES, LAYOUTS, LEAGUE_SPOTS, POSITIONS, SEPARATORS, SHADES, SIZES } from "@/lib/template-builder";

export type Opt = [string, string];

export const PLACEHOLDERS: [string, string][] = [
  ["{{BACKGROUND}}", "the photo behind the post"],
  ["{{PAGE_NAME}}", "your page name, or your logo if you chose it"],
  ["{{LEAGUE_LOGO}}", "the league logo (give its <img> class=\"league-logo\" to get the white version)"],
  ["{{HOME_NAME}} {{AWAY_NAME}}", "team names"],
  ["{{HOME_LOGO}} {{AWAY_LOGO}}", "team logos"],
  ["{{HOME_SCORE}} {{AWAY_SCORE}}", "the goals of each team"],
  ["{{HOME_EVENTS}} {{AWAY_EVENTS}}", "scorers and cards of each team"],
];

export const EXAMPLE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; font-family: Arial, sans-serif; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,0) 70%); }
  .brand { position: absolute; top: 30px; left: 36px; color: #fff; font-size: 34px; font-weight: 800; text-transform: uppercase; white-space: pre-line; }
  .board { position: absolute; left: 90px; right: 90px; bottom: 80px; color: #fff; text-align: center; }
  .row { display: flex; align-items: center; justify-content: space-between; }
  .row img { width: 170px; height: 170px; object-fit: contain; }
  .score { font-size: 200px; font-weight: 900; }
  .names { display: flex; justify-content: space-between; font-size: 32px; font-weight: 800; text-transform: uppercase; margin-top: 10px; }
  .events { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; margin-top: 30px; font-size: 24px; }
  .left { text-align: right; } .right { text-align: left; }
</style>
</head>
<body>
  <img class="bg" src="{{BACKGROUND}}" alt="">
  <div class="shade"></div>
  <div class="brand">{{PAGE_NAME}}</div>
  <div class="board">
    <div class="row">
      <img src="{{HOME_LOGO}}" alt="">
      <div class="score">{{HOME_SCORE}}-{{AWAY_SCORE}}</div>
      <img src="{{AWAY_LOGO}}" alt="">
    </div>
    <div class="names"><span>{{HOME_NAME}}</span><span>{{AWAY_NAME}}</span></div>
    <div class="events"><div class="left">{{HOME_EVENTS}}</div><div class="right">{{AWAY_EVENTS}}</div></div>
  </div>
</body>
</html>
`;

export const SIZE: Opt[] = SIZES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]);
export const LAYOUT: Opt[] = LAYOUTS.map((v) => [v, v === "side" ? "Logos beside the score" : "Score on top, teams below"]);
export const POSITION: Opt[] = POSITIONS.map((v) => [v, { upper: "Top", middle: "Middle", lower: "Bottom" }[v]]);
export const SHADE: Opt[] = SHADES.map((v) => [v, { none: "None", gradient: "Fade", panel: "Panel", band: "Band behind the score", card: "Rounded card" }[v]]);
export const FRAME: Opt[] = FRAMES.map((v) => [v, { none: "None", thin: "Thin", thick: "Thick" }[v]]);
export const SEPARATOR: Opt[] = SEPARATORS.map((v) => [v, `2 ${v} 1`]);
export const LEAGUE_SPOT: Opt[] = LEAGUE_SPOTS.map((v) => [v, { above: "Above the score", "top-left": "Top left", "top-center": "Top centre", "top-right": "Top right" }[v]]);
export const BRAND_SPOT: Opt[] = BRAND_SPOTS.map((v) => [
  v,
  { "top-left": "Top left", "top-center": "Top centre", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-center": "Bottom centre", "bottom-right": "Bottom right" }[v],
]);
export const FONT: Opt[] = Object.keys(FONTS).map((f) => [f, f]);
