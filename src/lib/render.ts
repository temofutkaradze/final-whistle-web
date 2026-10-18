import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { logoDataUri } from "@/lib/logos";

// Where the local render server (render-server.js) listens.
const RENDER_URL = process.env.RENDER_SERVER_URL ?? "http://127.0.0.1:4500/render";

// Customer backgrounds are downloaded here (inside this project).
const BACKGROUND_DIR = path.join(process.cwd(), "storage", "backgrounds");
const MAX_BACKGROUND_BYTES = 15 * 1024 * 1024;

import { pageNameForImage, sampleMatchFields } from "@/lib/sample-match";

// Re-exported: the dashboard and the worker format the page name the same way.
export { pageNameForImage };

// ---------------------------------------------------------------------------
// Background download (demo-level safety: http(s) only, no local addresses,
// images only, size limit). Tighten this before accepting real customers.
// ---------------------------------------------------------------------------

export async function downloadBackground(brandId: string, url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === "[::1]"
  ) {
    return null;
  }

  const res = await fetch(parsed, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Background download failed: HTTP ${res.status}`);

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : null;
  if (!ext) throw new Error("Background must be a PNG, JPEG or WebP image.");

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BACKGROUND_BYTES) throw new Error("Background image is larger than 15 MB.");

  await mkdir(BACKGROUND_DIR, { recursive: true });
  const file = path.join(BACKGROUND_DIR, `${brandId}.${ext}`);
  await writeFile(file, buf);
  return file;
}

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
    fixture_id: `sample_${brand.id}`,
    ...(await brandLookFields(brand)),
    ...(templateHtml ? { template: "classic", template_html: templateHtml } : {}),
    ...(backgroundPath ? { background_path: backgroundPath, background_data_uri: undefined } : {}),
  };

  const res = await fetch(RENDER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  const data = (await res.json().catch(() => ({}))) as { jpg_path?: string; error?: string };
  if (!res.ok || !data.jpg_path) {
    throw new Error(data.error ?? `Render server answered with HTTP ${res.status}`);
  }
  return data.jpg_path;
}
