import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// A page logo is uploaded from the dashboard and stored as storage/logos/<brandId>.png.
// The file is re-encoded with sharp: anything that is not a real PNG, JPEG or WebP picture is rejected,
// it is scaled down (small files, fast render) and no original bytes (scripts, metadata) are kept.

export const LOGO_DIR = path.join(process.cwd(), "storage", "logos");
export const MAX_LOGO_UPLOAD = 5 * 1024 * 1024;

export function logoFileFor(brandId: string): string {
  // brand ids are cuids; keep only safe characters anyway
  return path.join(LOGO_DIR, `${brandId.replace(/[^A-Za-z0-9_-]/g, "_")}.png`);
}

function isInsideLogoDir(p: string): boolean {
  const rel = path.relative(LOGO_DIR, path.resolve(p));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Returns the saved path, or null when the file is not a usable picture.
export async function saveLogo(brandId: string, upload: Buffer): Promise<string | null> {
  try {
    const meta = await sharp(upload, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) return null;
    const png = await sharp(upload, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await mkdir(LOGO_DIR, { recursive: true });
    const file = logoFileFor(brandId);
    await writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}

export async function deleteLogoFile(p: string | null | undefined): Promise<void> {
  if (!p || !isInsideLogoDir(p)) return;
  await unlink(p).catch(() => {});
}

// data: URI of the saved logo (for the render server and the dashboard preview), or null.
export async function logoDataUri(p: string | null | undefined): Promise<string | null> {
  if (!p || !isInsideLogoDir(p)) return null;
  try {
    const buf = await readFile(p);
    if (buf.length > 2_000_000) return null;
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
