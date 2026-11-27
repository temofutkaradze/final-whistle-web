const { createCapturePolicy } = require('../operations.js');

module.exports = function createImageExport({ sharp, FINAL_WIDTH, FINAL_HEIGHT, HIRES_WIDTH, HIRES_HEIGHT, JPEG_QUALITY, GRAIN_SIGMA }) {
let grainPromise = null;
function getGrain() {
  if (!grainPromise) {
    grainPromise = sharp({
      create: {
        width: FINAL_WIDTH,
        height: FINAL_HEIGHT,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: 'gaussian', mean: 128, sigma: GRAIN_SIGMA },
      },
    }).png().toBuffer();
  }
  return grainPromise;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------
// Screenshot (2160x2700) and final image (1080x1350 JPEG)
// ---------------------------------------------------------------------------------------------

// Same pixels as page.screenshot(): the PNG is lossless, we only ask Chromium for its fast PNG
// encoder because this PNG is just an in-memory step (file size does not matter).
// If that is unavailable or returns an unexpected size, the standard screenshot is used instead.
const capturePolicy=createCapturePolicy();
async function captureHiRes(page, context) {
  if (capturePolicy.enabled) {
    let client = null;
    try {
      client = await context.newCDPSession(page);
      const { data } = await withTimeout(
        client.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }),
        60000,
        'fast screenshot'
      );
      const buf = Buffer.from(data, 'base64');
      const meta = await sharp(buf).metadata();
      if (meta.width === HIRES_WIDTH && meta.height === HIRES_HEIGHT) {capturePolicy.success();return buf;}
      if(capturePolicy.failure())console.warn('Fast capture disabled after three qualifying failures.');
      console.warn(`Fast capture returned ${meta.width}x${meta.height}; using the standard screenshot instead.`);
    } catch (e) {
      // A stall retries on a new page; it never disables CDP or closes the shared browser.
      if (/timed out/.test(String(e.message))) throw e;
      if(capturePolicy.failure(e))console.warn('Fast capture disabled after three qualifying failures.');
      console.warn('Fast capture not available, using the standard screenshot:', String(e.message).split('\n')[0]);
    } finally {
      if (client) await client.detach().catch(() => {});
    }
  }
  return page.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 120000 });
}

// 2160x2700 PNG buffer -> 1080x1350 tagged sRGB JPEG buffer (Lanczos3 downscale)
async function makeJpeg(pngBuffer, { grain = true } = {}) {
  let img = sharp(pngBuffer)
    .flatten({ background: '#000000' })          // no alpha channel in the JPEG
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb');
  if (grain && GRAIN_SIGMA > 0) {
    img = img.composite([{ input: await getGrain(), blend: 'soft-light' }]);
  }
  return img.withIccProfile('srgb').jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' }).toBuffer();
}

// Wait until web fonts and every <img> (background, logos) are loaded and decoded, and one frame was painted,
// so nothing is captured with fallback fonts or half-loaded images.
async function waitUntilReady(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.decode ? img.decode().catch(() => {}) : Promise.resolve()
      )
    );
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise((r) => setTimeout(r, 500)),
    ]);
  });
}


return { captureHiRes, makeJpeg, waitUntilReady };
};
