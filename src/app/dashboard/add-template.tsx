"use client";

// "Add / edit template": build a template with options, or paste / edit its HTML. Both end as a normal template that is
// checked (render/template-check.js) and saved by a server action. Editing a built-in template always saves a NEW template
// (the built-in one never changes); editing the customer's own template can overwrite it or be saved as a new one.
// The preview is a sandboxed iframe: no script runs in it.

import { useActionState, useId, useMemo, useState } from "react";
import { checkTemplateHtml, withCsp } from "../../../render/template-check.js";
import { fillPlaceholders } from "@/lib/sample-match";
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
  type BuilderConfig,
} from "@/lib/template-builder";

export type Editing = { key: string; name: string; html: string; config: BuilderConfig | null; ownId: string | null };
export type SaveState = { error: string } | null;
type SaveAction = (prev: SaveState, formData: FormData) => Promise<SaveState>;
type Opt = [string, string];

const PLACEHOLDERS: [string, string][] = [
  ["{{BACKGROUND}}", "the photo behind the post"],
  ["{{PAGE_NAME}}", "your page name, or your logo if you chose it"],
  ["{{LEAGUE_LOGO}}", "the league logo (give its <img> class=\"league-logo\" to get the white version)"],
  ["{{HOME_NAME}} {{AWAY_NAME}}", "team names"],
  ["{{HOME_LOGO}} {{AWAY_LOGO}}", "team logos"],
  ["{{HOME_SCORE}} {{AWAY_SCORE}}", "the goals of each team"],
  ["{{HOME_EVENTS}} {{AWAY_EVENTS}}", "scorers and cards of each team"],
];

const EXAMPLE = `<!DOCTYPE html>
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

const SIZE: Opt[] = SIZES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]);
const LAYOUT: Opt[] = LAYOUTS.map((v) => [v, v === "side" ? "Logos beside the score" : "Score on top, teams below"]);
const POSITION: Opt[] = POSITIONS.map((v) => [v, { upper: "Top", middle: "Middle", lower: "Bottom" }[v]]);
const SHADE: Opt[] = SHADES.map((v) => [v, { none: "None", gradient: "Fade", panel: "Panel", band: "Band behind the score", card: "Rounded card" }[v]]);
const FRAME: Opt[] = FRAMES.map((v) => [v, { none: "None", thin: "Thin", thick: "Thick" }[v]]);
const SEPARATOR: Opt[] = SEPARATORS.map((v) => [v, `2 ${v} 1`]);
const LEAGUE_SPOT: Opt[] = LEAGUE_SPOTS.map((v) => [v, { above: "Above the score", "top-left": "Top left", "top-center": "Top centre", "top-right": "Top right" }[v]]);
const BRAND_SPOT: Opt[] = BRAND_SPOTS.map((v) => [
  v,
  { "top-left": "Top left", "top-center": "Top centre", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-center": "Bottom centre", "bottom-right": "Bottom right" }[v],
]);
const FONT: Opt[] = Object.keys(FONTS).map((f) => [f, f]);

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Opt[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </label>
  );
}
function RangeField({ label, value, min, max, step = 1, unit = "", onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label} ({value}
      {unit})
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} />
    </label>
  );
}
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function PreviewFrame({ html, title }: { html: string; title: string }) {
  return (
    <div className="add-preview" role="region" aria-label={title}>
      {html ? <iframe srcDoc={html} sandbox="" title={title} tabIndex={-1} scrolling="no" /> : <p>Nothing to preview yet.</p>}
    </div>
  );
}

export default function AddTemplate({
  save,
  used,
  max,
  brandHtml,
  editing,
}: {
  save: SaveAction;
  used: number;
  max: number;
  brandHtml: string;
  editing: Editing | null;
}) {
  const [state, formAction, pending] = useActionState(save, null);
  const [tab, setTab] = useState<"html" | "build">(editing && !editing.config ? "html" : "build");
  const [name, setName] = useState(editing ? (editing.ownId ? editing.name : `${editing.name} copy`) : "");
  const [saveMode, setSaveMode] = useState<"new" | "overwrite">("new");
  const [html, setHtml] = useState(editing?.html ?? "");
  const [cfg, setCfg] = useState<BuilderConfig>(editing?.config ?? DEFAULT_CONFIG);
  const set = <K extends keyof BuilderConfig>(key: K, value: BuilderConfig[K]) => setCfg((c) => ({ ...c, [key]: value }));

  const result = useMemo(() => (html.trim() ? checkTemplateHtml(html) : null), [html]);
  const htmlPreview = result?.ok ? withCsp(fillPlaceholders(html, brandHtml)) : "";
  const builtPreview = useMemo(() => withCsp(fillPlaceholders(buildTemplateHtml(cfg), brandHtml)), [cfg, brandHtml]);

  const full = used >= max;
  const overwriting = !!editing?.ownId && saveMode === "overwrite";
  const baseReason = !name.trim() ? "Give the template a name." : full && !overwriting ? `You have ${max} own templates. Delete one, or overwrite this one.` : "";
  const buildReason = baseReason;
  const htmlReason = baseReason || (!result ? "Paste or open some HTML first." : !result.ok ? "Fix the problems shown in red first." : "");

  // ARIA tabs pattern: only the selected tab is in the Tab order; arrow keys, Home and End move between the tabs.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const order = ["build", "html"] as const;
    const i = order.indexOf(tab);
    let next: (typeof order)[number] | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = order[(i + order.length - 1) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  function loadFile(file: File | undefined) {
    if (!file || file.size > 400_000) return;
    file.text().then((text) => {
      setHtml(text);
      if (!name.trim()) setName(file.name.replace(/\.html?$/i, "").slice(0, 40));
    });
  }

  const saveBox = (
    <>
      <input type="hidden" name="saveMode" value={overwriting ? "overwrite" : "new"} />
      <input type="hidden" name="editId" value={editing?.ownId ?? ""} />
      {editing?.ownId && (
        <fieldset className="b-group">
          <legend>When you save</legend>
          <label className="check" htmlFor="sm-new">
            <input id="sm-new" type="radio" name="sm" checked={saveMode === "new"} onChange={() => setSaveMode("new")} />
            Save as a new template (the old one stays)
          </label>
          <label className="check" htmlFor="sm-over">
            <input id="sm-over" type="radio" name="sm" checked={saveMode === "overwrite"} onChange={() => setSaveMode("overwrite")} />
            Overwrite “{editing.name}”
          </label>
        </fieldset>
      )}
      {editing && !editing.ownId && <p className="muted">“{editing.name}” stays exactly as it is. Your changes are saved as a new template.</p>}
    </>
  );

  return (
    <div className="add-inner">
      <div className="add-head">
        <h3>{editing ? `Edit “${editing.name}”` : "Add a template"}</h3>
        <a href="/dashboard#t-tpl" className="add-close">
          Close
        </a>
      </div>
      <p className="muted">You have {used} of {max} own templates.</p>

      <div className="tabs" role="tablist" aria-label="Template creation modes" onKeyDown={onTabKeyDown}>
        <button
          type="button"
          role="tab"
          id="tab-build"
          aria-controls="panel-build"
          aria-selected={tab === "build"}
          tabIndex={tab === "build" ? 0 : -1}
          className={tab === "build" ? "tab on" : "tab"}
          onClick={() => setTab("build")}
        >
          Build it here
        </button>
        <button
          type="button"
          role="tab"
          id="tab-html"
          aria-controls="panel-html"
          aria-selected={tab === "html"}
          tabIndex={tab === "html" ? 0 : -1}
          className={tab === "html" ? "tab on" : "tab"}
          onClick={() => setTab("html")}
        >
          HTML code
        </button>
      </div>

      {tab === "build" && (
        <div id="panel-build" role="tabpanel" aria-labelledby="tab-build">
        <form action={formAction} className="plain add-form">
          <input type="hidden" name="kind" value="build" />
          <input type="hidden" name="config" value={JSON.stringify(cfg)} />
          <div className="add-cols">
            <div className="add-controls">
              <label htmlFor="b-name">
                Template name
                <input id="b-name" type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="My template" />
              </label>

              <fieldset className="b-group">
                <legend>Start from</legend>
                <SelectField
                  label="Preset (replaces the options below)"
                  value=""
                  options={[["", "Choose a preset..."], ...PRESETS.map((p): Opt => [p.name, p.name])]}
                  onChange={(v) => {
                    const p = PRESETS.find((x) => x.name === v);
                    if (p) setCfg({ ...DEFAULT_CONFIG, ...p.patch });
                  }}
                />
              </fieldset>

              <fieldset className="b-group">
                <legend>Layout</legend>
                <div className="look-grid">
                  <SelectField label="Arrangement" value={cfg.layout} options={LAYOUT} onChange={(v) => set("layout", v as BuilderConfig["layout"])} />
                  <SelectField label="Block position" value={cfg.position} options={POSITION} onChange={(v) => set("position", v as BuilderConfig["position"])} />
                  <SelectField label="Score size" value={cfg.scoreSize} options={SIZE} onChange={(v) => set("scoreSize", v as BuilderConfig["scoreSize"])} />
                  <SelectField label="Team logo size" value={cfg.logoSize} options={SIZE} onChange={(v) => set("logoSize", v as BuilderConfig["logoSize"])} />
                </div>
                <RangeField label="Move up / down" value={cfg.offsetY} min={-300} max={300} step={10} unit=" px" onChange={(v) => set("offsetY", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>Text</legend>
                <div className="look-grid">
                  <SelectField label="Font" value={cfg.font} options={FONT} onChange={(v) => set("font", v as BuilderConfig["font"])} />
                  <SelectField label="Score separator" value={cfg.scoreSeparator} options={SEPARATOR} onChange={(v) => set("scoreSeparator", v as BuilderConfig["scoreSeparator"])} />
                  <SelectField label="Team name size" value={cfg.nameSize} options={SIZE} onChange={(v) => set("nameSize", v as BuilderConfig["nameSize"])} />
                  <SelectField label="Scorers size" value={cfg.eventsSize} options={SIZE} onChange={(v) => set("eventsSize", v as BuilderConfig["eventsSize"])} />
                  <ColorField label="Text colour" value={cfg.textColor} onChange={(v) => set("textColor", v)} />
                  <ColorField label="Score colour" value={cfg.scoreColor} onChange={(v) => set("scoreColor", v)} />
                </div>
                <CheckField label="Team names in capitals" checked={cfg.uppercaseNames} onChange={(v) => set("uppercaseNames", v)} />
                <CheckField label="Soft shadow behind the text" checked={cfg.textShadow} onChange={(v) => set("textShadow", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>Dark layer</legend>
                <div className="look-grid">
                  <SelectField label="Type" value={cfg.shade} options={SHADE} onChange={(v) => set("shade", v as BuilderConfig["shade"])} />
                  <ColorField label="Layer colour" value={cfg.shadeColor} onChange={(v) => set("shadeColor", v)} disabled={cfg.shade === "none"} />
                </div>
                <RangeField label="Strength" value={cfg.shadeOpacity} min={0} max={100} unit="%" onChange={(v) => set("shadeOpacity", v)} disabled={cfg.shade === "none"} />
                <CheckField label="Frosted glass (blur behind the layer)" checked={cfg.shadeBlur} onChange={(v) => set("shadeBlur", v)} />
                <CheckField label="Darker corners (vignette)" checked={cfg.vignette} onChange={(v) => set("vignette", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>Background photo</legend>
                <RangeField label="Brightness" value={cfg.bgBrightness} min={30} max={130} unit="%" onChange={(v) => set("bgBrightness", v)} />
                <RangeField label="Colour strength" value={cfg.bgSaturate} min={0} max={160} unit="%" onChange={(v) => set("bgSaturate", v)} />
                <RangeField label="Blur" value={cfg.bgBlur} min={0} max={20} unit=" px" onChange={(v) => set("bgBlur", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>Details</legend>
                <div className="look-grid">
                  <ColorField label="Line colour" value={cfg.accent} onChange={(v) => set("accent", v)} />
                  <SelectField label="Frame around the post" value={cfg.frame} options={FRAME} onChange={(v) => set("frame", v as BuilderConfig["frame"])} />
                </div>
                <CheckField label="Short line under the score" checked={cfg.accentLine} onChange={(v) => set("accentLine", v)} />
                <CheckField label="Line between the two scorer lists" checked={cfg.eventsDivider} onChange={(v) => set("eventsDivider", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>What to show</legend>
                <CheckField label="League logo" checked={cfg.showLeague} onChange={(v) => set("showLeague", v)} />
                {cfg.showLeague && <SelectField label="League logo position" value={cfg.leagueSpot} options={LEAGUE_SPOT} onChange={(v) => set("leagueSpot", v as BuilderConfig["leagueSpot"])} />}
                <CheckField label="Team names" checked={cfg.showNames} onChange={(v) => set("showNames", v)} />
                <CheckField label="Scorers and cards" checked={cfg.showEvents} onChange={(v) => set("showEvents", v)} />
              </fieldset>

              <fieldset className="b-group">
                <legend>Your page name or logo</legend>
                <div className="look-grid">
                  <SelectField label="Position" value={cfg.brand} options={BRAND_SPOT} onChange={(v) => set("brand", v as BuilderConfig["brand"])} />
                  <SelectField label="Size" value={cfg.brandSize} options={SIZE} onChange={(v) => set("brandSize", v as BuilderConfig["brandSize"])} />
                </div>
              </fieldset>

              {saveBox}
            </div>
            <PreviewFrame html={builtPreview} title="Preview of your template" />
          </div>
          {state?.error && <p className="notice error" role="alert">{state.error}</p>}
          {buildReason && <p className="muted">{buildReason}</p>}
          <div className="row">
            <button type="submit" disabled={!!buildReason || pending}>
              {pending ? (
                <span className="btn-spinner-wrap">
                  <svg className="btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Saving...
                </span>
              ) : (
                "Save template"
              )}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setHtml(buildTemplateHtml(cfg));
                setTab("html");
              }}
            >
              Open as HTML code
            </button>
          </div>
        </form>
        </div>
      )}

      {tab === "html" && (
        <div id="panel-html" role="tabpanel" aria-labelledby="tab-html">
        <form action={formAction} className="plain add-form">
          <input type="hidden" name="kind" value="html" />
          <div className="add-cols">
            <div className="add-controls">
              <label htmlFor="h-name">
                Template name
                <input id="h-name" type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="My template" />
              </label>
              <label htmlFor="h-html">
                HTML
                <textarea id="h-html" name="html" value={html} onChange={(e) => setHtml(e.target.value)} rows={14} spellCheck={false} placeholder="Paste your template here" />
              </label>
              <div className="row">
                <label htmlFor="h-file" className="file-pick">
                  Or open an .html file
                  <input id="h-file" type="file" accept=".html,.htm,text/html" onChange={(e) => loadFile(e.target.files?.[0])} />
                </label>
                <button type="button" className="ghost" onClick={() => setHtml(EXAMPLE)}>
                  Load an example
                </button>
              </div>
              {result && result.errors.length > 0 && (
                <ul className="check-list bad">
                  {result.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {result && result.ok && <p className="notice ok" role="status">The template passed the safety check.</p>}
              {result && result.warnings.length > 0 && (
                <ul className="check-list">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary>Placeholders you can use</summary>
                <ul className="check-list">
                  {PLACEHOLDERS.map(([p, d]) => (
                    <li key={p}>
                      <code>{p}</code>: {d}
                    </li>
                  ))}
                  <li>The image is 1080 x 1350 px. Scripts, links to other sites and outside pictures are not allowed; Google Fonts are.</li>
                </ul>
              </details>
              {saveBox}
            </div>
            <PreviewFrame html={htmlPreview} title="Preview of your HTML" />
          </div>
          {state?.error && <p className="notice error" role="alert">{state.error}</p>}
          {htmlReason && <p className="muted">{htmlReason}</p>}
          <button type="submit" disabled={!!htmlReason || pending}>
            {pending ? (
              <span className="btn-spinner-wrap">
                <svg className="btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Saving...
              </span>
            ) : (
              "Save template"
            )}
          </button>
        </form>
        </div>
      )}
    </div>
  );
}
