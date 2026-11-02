// Test helper: stands in for Playwright, so render/render-server.js can run in a test without Chromium.
// It is loaded with  node --require tests/helpers/fake-playwright.cjs render/render-server.js
//  - every "screenshot" is a plain 2160x2700 picture (the server shrinks it to the real 1080x1350 JPEG with sharp)
//  - when a custom template is drawn, the request guard installed by the server is asked about the URLs
//    in FW_PROBE_URLS, and its decisions are written to FW_PROBE_FILE (so a test can check what would be blocked)
const Module = require("module");
const fs = require("fs");
const sharp = require("sharp");

let png = null;
async function screenshot() {
  png ||= await sharp({ create: { width: 2160, height: 2700, channels: 3, background: { r: 10, g: 80, b: 40 } } }).png().toBuffer();
  return png;
}

function newPage() {
  let guard = null;
  return {
    route: async (_pattern, handler) => { guard = handler; },
    goto: async () => {
      if (guard && process.env.FW_PROBE_FILE) {
        const decisions = {};
        for (const url of JSON.parse(process.env.FW_PROBE_URLS || "[]")) {
          let decision = null;
          guard({ request: () => ({ url: () => url }), continue: () => { decision = "allow"; }, abort: () => { decision = "block"; } });
          decisions[url] = decision;
        }
        fs.writeFileSync(process.env.FW_PROBE_FILE, JSON.stringify(decisions));
      }
    },
    evaluate: async () => {},
    close: async () => {},
  };
}

const context = {
  newPage: async () => newPage(),
  newCDPSession: async () => ({ send: async () => ({ data: (await screenshot()).toString("base64") }), detach: async () => {} }),
};
const browser = { on() {}, newContext: async () => context, close: async () => {} };

const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === "playwright") return { chromium: { launch: async () => browser } };
  return original.call(this, request, ...rest);
};
