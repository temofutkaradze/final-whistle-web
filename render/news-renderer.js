
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {prepareStandingsBackground,normalizeStandingsCrest}=require('./standings-artwork.js');
const {withPageDeadline}=require("./operations.js");

module.exports = function createNewsRenderer({
  getBrowser,
  captureHiRes,
  makeJpeg,
  sharp,
  outputDir,
}) {
  return async function renderNews(job, background, circle) {
    const validLayouts = ["single", "left", "right", "breaking", "standings"];

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
      return metadata;
    }

    const backgroundMeta=await validateImage(background, "background");
    await validateImage(circle, "circle");
    
    const { buildHtml } = await import(
      "../src/lib/news/html.ts"
    );

    // Normalize orientation (phone EXIF) before Chromium sees the bytes.
    // Standings embeds unchanged primary bytes unless EXIF needs orientation.
    // Existing News layouts keep their original normalization path.
    const prepared=job.layout==='standings'?await prepareStandingsBackground(background,backgroundMeta):null;
    const bg = prepared?prepared.primary:await sharp(background).rotate().png().toBuffer();
    const secondary = circle ? await sharp(circle).rotate().png().toBuffer() : null;
    let html;
    if(job.layout==='standings'){
      const {validateTable}=await import('../src/lib/news/standings.ts');
      validateTable(job.standings,job.standings?.leagueId,Date.now(),true);
      const normalized=[],backings=[];
      for(const value of [job.standings.leagueLogo,...job.standings.rows.map(r=>r.crest)]){
        const bytes=Buffer.from(value,'base64');
        await validateImage(bytes,'standings crest');
        const meta=await sharp(bytes,{limitInputPixels:25_000_000}).metadata();
        if((meta.pages??1)>1||meta.width>1024||meta.height>1024)throw new Error('Invalid standings crest dimensions or animation');
        const artwork=await normalizeStandingsCrest(bytes);
        normalized.push(artwork.png.toString('base64'));backings.push(artwork.lightBacking);
      }
      job={...job,standings:{...job.standings,leagueLogo:normalized[0],rows:job.standings.rows.map((r,i)=>({...r,crest:normalized[i+1]}))}};
      const {buildStandingsHtml}=await import('../src/lib/news/standings-html.ts');
      const {clubDisplayName}=await import('../src/lib/news/club-display-names.ts');
      const reviewCount=job.standings.rows.filter(r=>clubDisplayName(r).needsReview).length;
      if(reviewCount)console.warn('Standings artwork: '+reviewCount+' unmapped club name(s) need review; original names retained.');
      // One deterministic cover crop; no backdrop copy or subject detection.
      html=buildStandingsHtml(job,bg,backings.slice(1));
    }else html=buildHtml(job, bg, secondary);

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

      // Quotes/editorial posts retain the native lossless capture: no resize,
      // JPEG encoder, sharpening or grain. Preserve the existing standings export.
      const lossless = job.layout !== 'standings';
      const bytes = lossless ? png : await makeJpeg(png, { grain: false });

      fs.mkdirSync(outputDir, { recursive: true });

      const imagePath = path.join(
        outputDir,
        `news_${crypto.randomUUID()}.${lossless ? 'png' : 'jpg'}`
      );

      fs.writeFileSync(imagePath, bytes);

      return lossless ? { png_path: imagePath } : { jpg_path: imagePath };
    } finally {
      await context.close().catch(() => {});
    }
  };
};
