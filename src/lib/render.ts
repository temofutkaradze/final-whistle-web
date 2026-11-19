import {renderHeaders} from "../../render/security.js";
import { logoDataUri } from "@/lib/logos";

// Where the local render server (render-server.js) listens.
const RENDER_URL = process.env.RENDER_SERVER_URL ?? "http://127.0.0.1:4500/render";

import { pageNameForImage, sampleMatchFields } from "@/lib/sample-match";

// Re-exported: the dashboard and the worker format the page name the same way.
export { pageNameForImage };

// ---------------------------------------------------------------------------
// Background download (demo-level safety: http(s) only, no local addresses,
// images only, size limit). Tighten this before accepting real customers.
// ---------------------------------------------------------------------------

import {downloadBackground} from "../../scripts/lib/background-download.mjs";
export {downloadBackground};

// ---------------------------------------------------------------------------
// The look of a customer's posts: which template, and the page name or the page logo.
// Used for the sample post and (same idea in scripts/lib/render.mjs) for real posts.
// ---------------------------------------------------------------------------

export type BrandLook = {
  name: string;
  templateRef: string;
  brandMode: string;
  logoPath: string | null;
};

export async function brandLookFields(brand: BrandLook): Promise<{ template: string; page_name: string; page_logo_data_uri?: string }> {
  const fields: { template: string; page_name: string; page_logo_data_uri?: string } = {
    template: brand.templateRef || "classic",
    page_name: pageNameForImage(brand.name),
  };
  if (brand.brandMode === "logo") {
    const uri = await logoDataUri(brand.logoPath);
    if (uri) fields.page_logo_data_uri = uri; // no file (or unreadable): the page name is shown instead
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Render a sample post for a customer's page. Returns the JPG path on this computer.
// ---------------------------------------------------------------------------

export async function renderSamplePost(brand: BrandLook & {
  id: string;
  backgroundUrl: string | null;
}, templateHtml?: string): Promise<string> {
  const backgroundPath = brand.backgroundUrl ? await downloadBackground(brand.id, brand.backgroundUrl) : null;
  const sample = sampleMatchFields();

  const payload = {
    ...sample,
    output_format: 'png',
    fixture_id: `sample_${brand.id}`,
    ...(await brandLookFields(brand)),
    ...(templateHtml ? { template: "classic", template_html: templateHtml } : {}),
    ...(backgroundPath ? { background_path: backgroundPath, background_data_uri: undefined } : {}),
  };

  const res = await fetch(RENDER_URL, {
    method: "POST",
    headers: renderHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  const data = (await res.json().catch(() => ({}))) as { png_path?:string; jpg_path?: string; error?: string };
  if (!res.ok || typeof data.png_path!=='string'||!data.png_path.toLowerCase().endsWith('.png')) {
    throw new Error(data.error ?? `Render server answered with HTTP ${res.status}`);
  }
  return data.png_path;
}
