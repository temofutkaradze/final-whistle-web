// Shared Chromium lifecycle. Constructed once by render-server.js.
module.exports = function createBrowserRuntime({ chromium }) {
let browserPromise = null;
let currentBrowser = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch()
      .then((browser) => {
        currentBrowser = browser;
        // If Chromium dies, start a fresh one on the next render instead of failing until a restart
        browser.on('disconnected', () => {
          if (currentBrowser === browser) {
            console.warn('Browser disconnected; a new one will be started on the next render.');
            browserPromise = null;
            contextPromise = null;
            currentBrowser = null;
          }
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// One shared browser context: its cache survives between renders, so the Google Fonts files are
// downloaded only once instead of on every render (faster and more reliable).
// CSS coordinate system stays 1080x1350; deviceScaleFactor 2 renders it at 2160x2700 physical pixels.
let contextPromise = null;
function getContext() {
  if (!contextPromise) {
    contextPromise = getBrowser()
      .then((browser) => browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 }))
      .catch((err) => {
        contextPromise = null;
        throw err;
      });
  }
  return contextPromise;
}

// Explicit shutdown only. Request failures must never close other in-flight contexts.
async function resetBrowser() {
  const b = browserPromise;
  browserPromise = null;
  contextPromise = null;
  currentBrowser = null;
  try { const browser = await b; if (browser) await browser.close(); } catch (e) { /* already gone */ }
}


return { getBrowser, getContext, resetBrowser };
};
