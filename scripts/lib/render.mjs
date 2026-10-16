import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";

const RENDER_URL = process.env.RENDER_SERVER_URL ?? "http://127.0.0.1:4500/render";

export const BACKGROUND_DIR = path.join(process.cwd(), "storage", "backgrounds");

const svgUri = (svg) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);

export const DEFAULT_BACKGROUND = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1b7a4f"/><stop offset="1" stop-color="#07241a"/>` +
    `</linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/></svg>`,
);

// The template shows the page name one word per line.
export function pageNameForImage(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.slice(0, 16))
    .join("\n");
}

// The look of a customer's posts: the template and the page name, or the page logo (saved by the dashboard in
// storage/logos). No logo file (or logo mode off) means the page name is shown.
const LOGO_DIR = path.join(process.cwd(), "storage", "logos");

export async function brandLookFields(brand) {
  const fields = {
    template: brand?.templateRef || "classic",
    page_name: pageNameForImage(brand?.name ?? "final whistle"),
  };
  if (brand?.brandMode === "logo" && brand.logoPath) {
    const rel = path.relative(LOGO_DIR, path.resolve(brand.logoPath));
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      try {
        const buf = await readFile(brand.logoPath);
        if (buf.length <= 2_000_000) fields.page_logo_data_uri = `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
        /* missing file: the page name is shown instead */
      }
    }
  }
  return fields;
}

export async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Demo-level safe download of a background from a URL (http(s) only, no local hosts, images only).
export async function downloadBackground(brandId, url) {
  let parsed;
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
  if (buf.length > 15 * 1024 * 1024) throw new Error("Background image is larger than 15 MB.");
  await mkdir(BACKGROUND_DIR, { recursive: true });
  const file = path.join(BACKGROUND_DIR, `${brandId}.${ext}`);
  await writeFile(file, buf);
  return file;
}

export async function renderPost(payload) {
  const res = await fetch(RENDER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.jpg_path) throw new Error(data.error ?? `Render server answered with HTTP ${res.status}`);
  return data.jpg_path;
}
