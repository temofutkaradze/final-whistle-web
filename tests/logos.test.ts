import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// logos.ts keeps the files in <current folder>/storage/logos. The tests use a temporary folder, never the real one.
let dir: string;
let logos: typeof import("@/lib/logos");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fw-logos-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.resetModules();
  logos = await import("@/lib/logos");
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const picture = (format: "png" | "jpeg" | "webp", width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })[format]().toBuffer();

describe("page logo upload", () => {
  it("keeps the logo folder inside the project's storage folder", () => {
    expect(logos.LOGO_DIR).toBe(join(dir, "storage", "logos"));
  });

  it("accepts PNG, JPEG and WebP, scales them down and saves a PNG", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const saved = await logos.saveLogo(`brand-${format}`, await picture(format));
      expect(saved, format).toBe(logos.logoFileFor(`brand-${format}`));
      const meta = await sharp(saved as string).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBeLessThanOrEqual(800);
      expect(meta.height).toBeLessThanOrEqual(400);
    }
  });

  it("does not enlarge a small logo", async () => {
    const saved = await logos.saveLogo("small", await picture("png", 120, 60));
    expect(await sharp(saved as string).metadata()).toMatchObject({ width: 120, height: 60 });
  });

  it("refuses files that are not a real PNG, JPEG or WebP picture", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const png = await picture("png");
    for (const [name, data] of [
      ["svg with a script", svg],
      ["plain text", Buffer.from("hello")],
      ["empty file", Buffer.alloc(0)],
      ["cut-off picture", png.subarray(0, 60)],
    ] as const) {
      expect(await logos.saveLogo("bad", data), name).toBeNull();
    }
    expect(existsSync(logos.logoFileFor("bad"))).toBe(false);
  });

  it("refuses real pictures in formats other than PNG, JPEG and WebP", async () => {
    // sharp can read these, so only our own format check stops them
    const tiff = await sharp({ create: { width: 40, height: 40, channels: 3, background: "red" } }).tiff().toBuffer();
    const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: "red" } }).gif().toBuffer();
    expect(await logos.saveLogo("tiff", tiff)).toBeNull();
    expect(await logos.saveLogo("gif", gif)).toBeNull();
    expect(existsSync(logos.logoFileFor("tiff"))).toBe(false);
  });

  it("a brand id can never move the file out of the logo folder", async () => {
    const saved = await logos.saveLogo("../../evil", await picture("png", 50, 50));
    expect(saved).not.toBeNull();
    expect((saved as string).startsWith(logos.LOGO_DIR)).toBe(true);
    expect(logos.logoFileFor("../../evil")).toBe(join(logos.LOGO_DIR, "______evil.png"));
  });

  it("reads a saved logo as a data: URI (for the render server and the preview)", async () => {
    const saved = await logos.saveLogo("uri", await picture("png", 100, 50));
    const uri = await logos.logoDataUri(saved);
    expect(uri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    expect(await logos.logoDataUri(null)).toBeNull();
    expect(await logos.logoDataUri(join(logos.LOGO_DIR, "missing.png"))).toBeNull();
  });

  it("only touches files inside the logo folder", async () => {
    const outside = join(dir, "secret.txt");
    writeFileSync(outside, "keep me");
    expect(await logos.logoDataUri(outside)).toBeNull();
    await logos.deleteLogoFile(outside);
    expect(existsSync(outside)).toBe(true);
    await logos.deleteLogoFile(join(logos.LOGO_DIR, "..", "..", "secret.txt"));
    expect(existsSync(outside)).toBe(true);

    const saved = (await logos.saveLogo("to-delete", await picture("png", 40, 40))) as string;
    expect(existsSync(saved)).toBe(true);
    await logos.deleteLogoFile(saved);
    expect(existsSync(saved)).toBe(false);
    await logos.deleteLogoFile(null); // nothing to delete: no error
  });
});
