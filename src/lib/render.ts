import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Where the local render server (render-server.js) listens.
const RENDER_URL = process.env.RENDER_SERVER_URL ?? "http://localhost:4500/render";

// Customer backgrounds are downloaded here (inside this project).
const BACKGROUND_DIR = path.join(process.cwd(), "storage", "backgrounds");
const MAX_BACKGROUND_BYTES = 15 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers for the sample match (everything is invented: no real clubs or logos)
// ---------------------------------------------------------------------------

function svgUri(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function teamBadge(letter: string, color: string): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">` +
      `<circle cx="75" cy="75" r="68" fill="${color}" stroke="#ffffff" stroke-width="6"/>` +
      `<text x="75" y="102" font-family="Arial, sans-serif" font-size="80" font-weight="700" ` +
      `text-anchor="middle" fill="#ffffff">${letter}</text></svg>`,
  );
}

// The template turns league logos into a white silhouette, so this is just a plain ring + letter.
const SAMPLE_LEAGUE_LOGO = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">` +
    `<circle cx="75" cy="75" r="62" fill="none" stroke="#000000" stroke-width="10"/>` +
    `<text x="75" y="100" font-family="Arial, sans-serif" font-size="70" font-weight="700" ` +
    `text-anchor="middle" fill="#000000">L</text></svg>`,
);

// Used when the customer has not set a background image.
const DEFAULT_BACKGROUND = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1b7a4f"/><stop offset="1" stop-color="#07241a"/>` +
    `</linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/></svg>`,
);

const homeEvent = (minute: string, name: string) =>
  `<div class="event"><span class="minute">${minute}'</span><span class="sep">|</span><span class="player-name">${name}</span></div>`;
const awayEvent = (minute: string, name: string) =>
  `<div class="event"><span class="player-name">${name}</span><span class="sep">|</span><span class="minute">${minute}'</span></div>`;

// The template shows the page name one word per line (like "day / on / football").
export function pageNameForImage(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.slice(0, 16))
    .join("\n");
}

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
// Render a sample post for a customer's page. Returns the JPG path on this computer.
// ---------------------------------------------------------------------------

export async function renderSamplePost(brand: {
  id: string;
  name: string;
  backgroundUrl: string | null;
}): Promise<string> {
  const backgroundPath = brand.backgroundUrl ? await downloadBackground(brand.id, brand.backgroundUrl) : null;

  const payload = {
    fixture_id: `sample_${brand.id}`,
    page_name: pageNameForImage(brand.name),
    ...(backgroundPath ? { background_path: backgroundPath } : { background_data_uri: DEFAULT_BACKGROUND }),
    league_logo: SAMPLE_LEAGUE_LOGO,
    home_logo: teamBadge("A", "#1b7a4f"),
    away_logo: teamBadge("B", "#24407a"),
    home_team: "FC Alpha",
    away_team: "FC Beta",
    home_score: 2,
    away_score: 1,
    total_events: 3,
    home_events_html: homeEvent("12", "J. Sample") + homeEvent("67", "K. Demo"),
    away_events_html: awayEvent("81", "L. Test"),
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
