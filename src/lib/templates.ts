import { readFile } from "node:fs/promises";
import path from "node:path";
import { pageNameForImage, sampleMatchFields } from "@/lib/render";

// Built-in templates: the files live in render/templates/<key>.html (the render server reads the same files).
export const BUILTIN_TEMPLATES = [
  { key: "classic", name: "Classic", note: "Big score, scorers on both sides." },
  { key: "panel", name: "Panel", note: "Dark panel under the photo." },
  { key: "frame", name: "Frame", note: "Thin frame, centred score." },
  { key: "stripe", name: "Stripe", note: "Band across the photo." },
] as const;

export function isBuiltinTemplate(key: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.key === key);
}

const TEMPLATES_DIR = path.join(process.cwd(), "render", "templates");

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

// A template filled with the invented sample match: used for the live previews on the dashboard
// (shown in a sandboxed iframe, so no script can run).
export async function templatePreviewHtml(key: string, brandHtml: string): Promise<string> {
  const safeKey = isBuiltinTemplate(key) ? key : "classic";
  let html = await readFile(path.join(TEMPLATES_DIR, `${safeKey}.html`), "utf8");
  const s = sampleMatchFields();
  const values: Record<string, string | number> = {
    "{{BACKGROUND}}": s.background_data_uri,
    "{{PAGE_NAME}}": brandHtml,
    "{{EVENTS_CLASS}}": "",
    "{{TOTAL_EVENTS}}": s.total_events,
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
  for (const [k, v] of Object.entries(values)) html = html.split(k).join(String(v));
  return html;
}
