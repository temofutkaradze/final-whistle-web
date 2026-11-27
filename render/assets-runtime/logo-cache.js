const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { createSingleFlight } = require('../operations.js');

module.exports = function createLogoCache({ ROOT, ALLOWED_FILE_DIRS, EMPTY_IMAGE, security }) {
const LOGO_CACHE_DIR = path.join(ROOT, 'cache', 'logos');
const LOGO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // re-download after 14 days
const LOGO_DOWNLOAD_TIMEOUT_MS = 8000;
const LOGO_EXTS = ['png', 'jpg', 'svg', 'webp', 'gif'];

function findCachedLogo(key, allowStale) {
  for (const ext of LOGO_EXTS) {
    const p = path.join(LOGO_CACHE_DIR, `${key}.${ext}`);
    try {
      const st = fs.statSync(p);
      if (st.size<=5*1024*1024 && (allowStale || Date.now() - st.mtimeMs < LOGO_CACHE_MAX_AGE_MS)) {security.insideFile(p,[LOGO_CACHE_DIR]);return p;}
    } catch (e) { /* not cached with this extension */ }
  }
  return null;
}

function extFromContentType(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('svg')) return 'svg';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('png')) return 'png';
  const m = String(url).toLowerCase().match(/\.(png|jpe?g|svg|webp|gif)(\?|$)/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  return 'png';
}

const logoFlights=createSingleFlight(16);

// Canonicalize first: every HTTP(S) image goes through the pinned downloader.
async function localizeImage(url) {
  url=security.imageSource(url,{fileDirectories:ALLOWED_FILE_DIRS});
  if (!/^https?:/.test(url)) return url;
  const key = crypto.createHash('sha1').update(String(url)).digest('hex');
  const toFileUrl = (p) => pathToFileURL(p).href;
  return logoFlights.run(key,async()=>{
    try {
      const fresh = findCachedLogo(key, false);
      if (fresh) return toFileUrl(fresh);

      fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });
      const resource = await security.downloadPublicResource(String(url), {timeoutMs:LOGO_DOWNLOAD_TIMEOUT_MS,maxBytes:5*1024*1024});
      const buf = resource.body;
      if (buf.length < 64) throw new Error('response too small to be an image');

      if(!resource.contentType.startsWith('image/'))throw new Error('Invalid image response');
      await security.validateMatchImage(buf);
      const ext = extFromContentType(resource.contentType, url);
      const finalPath = path.join(LOGO_CACHE_DIR, `${key}.${ext}`);
      const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, finalPath);
      return toFileUrl(finalPath);
    } catch (e) {
      // Download failed: an expired cached copy is still better than a broken image
      const stale = findCachedLogo(key, true);
      if (stale) {
        console.warn("Logo download unavailable; using the cached image.");
        return toFileUrl(stale);
      }
      console.warn("Logo download unavailable; using a transparent fallback.");
      return EMPTY_IMAGE;
    }
  });
}

return { localizeImage };
};
