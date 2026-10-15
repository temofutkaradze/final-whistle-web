import { unlink } from "node:fs/promises";
import path from "node:path";

// Safe deletion of background files. Everything lives in storage/backgrounds
// (the folder the bot and worker already use for photos sent in Telegram).

export const BACKGROUND_DIR = path.join(process.cwd(), "storage", "backgrounds");

// Only files inside storage/backgrounds may ever be deleted (the paths come from the database).
export function isInsideBackgroundDir(p: string): boolean {
  const rel = path.relative(BACKGROUND_DIR, path.resolve(p));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function deleteBackgroundFile(p: string | null | undefined): Promise<void> {
  if (!p || !isInsideBackgroundDir(p)) return;
  await unlink(p).catch(() => {});
}

// A background that was downloaded from a link is saved as <brandId>.<ext>.
export async function deleteDownloadedBackground(brandId: string): Promise<void> {
  for (const ext of ["png", "jpg", "webp"]) {
    await deleteBackgroundFile(path.join(BACKGROUND_DIR, `${brandId}.${ext}`));
  }
}

// Removes every file that belongs to one account: the photo waiting to be assigned to a match,
// the photos chosen for matches, and downloaded page backgrounds.
export async function deleteAccountFiles(data: {
  pendingBackgroundPath: string | null;
  brands: { id: string; backgroundPath: string | null }[];
  selections: { backgroundPath: string | null }[];
}): Promise<void> {
  const paths = new Set<string>();
  if (data.pendingBackgroundPath) paths.add(data.pendingBackgroundPath);
  for (const b of data.brands) if (b.backgroundPath) paths.add(b.backgroundPath);
  for (const s of data.selections) if (s.backgroundPath) paths.add(s.backgroundPath); // "all matches" shares one file
  for (const p of paths) await deleteBackgroundFile(p);
  for (const b of data.brands) await deleteDownloadedBackground(b.id);
}
