
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {alignBranding}=require("./branding-position.js");
const {prepareStandingsBackground,normalizeStandingsCrest,normalizeStandingsLeagueLogo}=require('./standings-artwork.js');
const {withPageDeadline}=require("./operations.js");
const {createNewsAssets}=require('./news-assets.js');

module.exports = function createNewsRenderer({
  getBrowser,
  captureHiRes,
  makeJpeg,
  sharp,
  outputDir,
}) {
  return async function renderNews(job, background, circle, signal) {
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
    const assets=createNewsAssets();
    if(job.brandingOnly===true){
      // Match News's high-resolution rasterization without cropping the source.
      // Keep larger originals; smaller inputs fit within the 2160x2700 export envelope.
      const bytes=await sharp(background).rotate().png().toBuffer();
      const source=await sharp(bytes).metadata();
      const scale=Math.max(1,Math.min(2160/source.width,2700/source.height));
      const width=Math.round(source.width*scale),height=Math.round(source.height*scale);
      const browser=await getBrowser();
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
      try{
        const page=await context.newPage();
        const png=await withPageDeadline(page,async()=>{
          await page.route('**/*',assets.route);
          await page.setContent(`<html><body style="margin:0;overflow:hidden;width:${width}px;height:${height}px"><img style="display:block;width:${width}px;height:${height}px" src="${assets.add(bytes)}"></body></html>`);
          await page.evaluate(()=>document.images[0].decode());
          await alignBranding(page);
          // Branding can retain non-poster dimensions. Keep it independent of the
          // shared fixed-size capture policy used by Match and other News layouts.
          return page.screenshot({type:'png',scale:'device',animations:'disabled',timeout:120000});
        },undefined,signal);
        const meta=await sharp(png).metadata();
        if(meta.format!=='png'||meta.width!==width||meta.height!==height)throw new Error('Unexpected Branding image dimensions or format');
        fs.mkdirSync(outputDir,{recursive:true});
        const imagePath=path.join(outputDir,`news_${crypto.randomUUID()}.png`);
        signal?.throwIfAborted();fs.writeFileSync(imagePath,png);return {png_path:imagePath};
      }finally{await context.close().catch(()=>{});}
    }
    
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
      // News-only local copy of the exact lion-only Premier League asset used by Match.
      // Keep it outside Match's watched league-symbol directory so Match output stays untouched.
      const leagueLogoBytes=job.standings.leagueId===39
        ?fs.readFileSync(path.join(__dirname,'assets','news','league-symbols','39.png'))
        :Buffer.from(job.standings.leagueLogo,'base64');
      await validateImage(leagueLogoBytes,'standings crest');
      const leagueLogoMeta=await sharp(leagueLogoBytes,{limitInputPixels:25_000_000}).metadata();
      if((leagueLogoMeta.pages??1)>1||leagueLogoMeta.width>1024||leagueLogoMeta.height>1024)throw new Error('Invalid standings crest dimensions or animation');
      const leagueLogo=job.standings.leagueId===39
        ?await normalizeStandingsLeagueLogo(leagueLogoBytes)
        :await normalizeStandingsCrest(leagueLogoBytes);
      normalized.push(leagueLogo.png.toString('base64'));
      for(const value of job.standings.rows.map(r=>r.crest)){
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
      html=buildStandingsHtml(job,bg,backings,leagueLogo.markSize);
    }else html=buildHtml(job, bg, secondary,assets.add);

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
        await page.route('**/*',assets.route);

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
        if (error === 'NEWS_MANUAL_LAYOUT_UNSAFE') throw Object.assign(new Error('Manual Large Headline does not fit safely.'),{code:error});
        if (error) throw new Error(error);

        if(job.branding===true)await alignBranding(page);
        return captureHiRes(page, context);
      },undefined,signal);
      const meta = await sharp(png).metadata();

      if (meta.width !== 2160 || meta.height !== 2700) {
        throw new Error("Unexpected News image dimensions");
      }

      // Existing News layouts retain their prior export choice. Standings now
      // bypasses the JPEG branch and writes this verified capture unchanged.
      const lossless = job.layout !== 'standings';
      const bytes = job.layout === 'standings' ? png : lossless ? png : await makeJpeg(png, { grain: false });

      fs.mkdirSync(outputDir, { recursive: true });

      const imagePath = path.join(
        outputDir,
        `news_${crypto.randomUUID()}.${job.layout === 'standings' || lossless ? 'png' : 'jpg'}`
      );

      signal?.throwIfAborted();fs.writeFileSync(imagePath, bytes);

      return job.layout === 'standings' || lossless ? { png_path: imagePath } : { jpg_path: imagePath };
    } finally {
      await context.close().catch(() => {});
    }
  };
};
