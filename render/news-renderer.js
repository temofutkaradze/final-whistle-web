
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {withPageDeadline}=require("./operations.js");

module.exports = function createNewsRenderer({
  getBrowser,
  captureHiRes,
  makeJpeg,
  sharp,
  outputDir,
}) {
  return async function renderNews(job, background, circle) {
    const validLayouts = ["single", "left", "right", "breaking"];

    if (!job || !validLayouts.includes(job.layout)) {
      throw new Error("Invalid News layout");
    }

    if (!Buffer.isBuffer(background) || !background.length) {
      throw new Error("Missing News background");
    }
    if (["left", "right"].includes(job.layout) && !Buffer.isBuffer(circle)) throw new Error("Missing secondary image");
    async function validateImage(buffer, name) {
      if (buffer == null) return;

      const metadata = await sharp(buffer).metadata();

      if (!["jpeg", "png", "webp"].includes(metadata.format)) {
        throw new Error(`Unsupported ${name} image format`);
      }

      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8000 ||
        metadata.height > 8000 ||
        metadata.width * metadata.height > 25000000
      ) {
        throw new Error(`Invalid ${name} image dimensions`);
      }
    }

    await validateImage(background, "background");
    await validateImage(circle, "circle");
    
    const { buildHtml } = await import(
      "../src/lib/news/html.ts"
    );

    // Normalize orientation (phone EXIF) before Chromium sees the bytes.
    const bg = await sharp(background).rotate().png().toBuffer();
    const secondary = circle ? await sharp(circle).rotate().png().toBuffer() : null;
    const html = buildHtml(job, bg, secondary);

    // Separate browser context: Match rendering remains isolated.
    const browser = await getBrowser();
    const context = await browser.newContext({
      // Match the original CSS scale(2) rasterization, while using the same
      // shared Chromium capture and Sharp exporter as Match.
      viewport: { width: 2160, height: 2700 },
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();

      const png=await withPageDeadline(page,async()=>{
        await page.route("**/*", (route) => {
          const url = route.request().url();
          let allowed = false;

          try {
            const parsed = new URL(url);
            allowed =
              parsed.protocol === "data:" ||
              parsed.protocol === "about:" ||
              false; // News fonts and images are embedded. No network or local-file access.
          } catch {}

          return allowed ? route.continue() : route.abort();
        });

        await page.setContent(html, {
          waitUntil: "load",
          timeout: 60000,
        });

        await page.waitForFunction(
          () =>
            document.documentElement.getAttribute("data-ready") === "1",
          null,
          { timeout: 30000 }
        );
        const error = await page.evaluate(() => document.documentElement.getAttribute('data-error'));
        if (error) throw new Error(error);

        return captureHiRes(page, context);
      });
      const meta = await sharp(png).metadata();

      if (meta.width !== 2160 || meta.height !== 2700) {
        throw new Error("Unexpected News image dimensions");
      }

      // News never adds grain; use the shared tagged-sRGB JPEG exporter.
      const jpg = await makeJpeg(png, { grain: false });

      fs.mkdirSync(outputDir, { recursive: true });

      const jpgPath = path.join(
        outputDir,
        `news_${crypto.randomUUID()}.jpg`
      );

      fs.writeFileSync(jpgPath, jpg);

      return { jpg_path: jpgPath };
    } finally {
      await context.close().catch(() => {});
    }
  };
};
