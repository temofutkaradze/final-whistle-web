const crypto = require('crypto');

// News HTTP validation/protocol; rendering remains injected by the server.
module.exports = function createNewsHttpHandler({ renderNews }) {
async function handleNewsRequest(req, res, signal) {
  const secret = process.env.NEWS_RENDER_SECRET;
  const supplied = req.headers["x-news-render-secret"];

  const expectedBuffer = Buffer.from(secret || "");
  const suppliedBuffer = Buffer.from(
    typeof supplied === "string" ? supplied : ""
  );

  if (
    !secret ||
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  if (req.method === 'GET' && req.url === '/news-health') {
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({service:'final-whistle-news',protocolVersion:2}));
    return;
  }

  const MAX_BYTES = 45 * 1024 * 1024;
  let chunks = [];
  let total = 0;

  try {
    for await (const chunk of req) {
      total += chunk.length;

      if (total > MAX_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request too large" }));
        return;
      }

      chunks.push(chunk);
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));


    const job = payload.job;

    if (
      !job ||
      typeof job !== "object" ||
      Array.isArray(job) ||
      !["single", "left", "right", "breaking", "standings"].includes(job.layout) ||
      typeof job.quote !== "string" ||
      typeof job.author !== "string" ||
      typeof job.caption !== "string" ||
      job.quote.length > 4096 ||
      job.author.length > 4096 ||
      job.caption.length > 4096 ||
      !job.pos ||
      typeof job.pos !== "object"
    ) {
      throw new Error("Invalid News job");
    }

    function validPosition(value) {
      return (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((n) => typeof n === "number" && Number.isFinite(n))
      );
    }

    if (!validPosition(job.pos.b) || !validPosition(job.pos.c)) {
      throw new Error("Invalid image position");
    }

    function decodeImage(value, required) {
      if (value == null && !required) return null;

      if (
        typeof value !== "string" ||
        !value.length ||
        value.length > 30 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
        value.length % 4 !== 0
      ) {
        throw new Error("Invalid image data");
      }

      const buffer = Buffer.from(value, "base64");

      if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
        throw new Error("Invalid image size");
      }

      return buffer;
    }

    const background = decodeImage(payload.background, true);
    const circle = decodeImage(payload.circle, false);

    signal?.throwIfAborted();
    const result = await renderNews(job, background, circle,signal);


    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("[news render]", error.message);

    if(res.destroyed)return;
    const manualLayoutUnsafe=error?.code==='NEWS_MANUAL_LAYOUT_UNSAFE';
    res.writeHead(manualLayoutUnsafe?422:signal?.aborted?504:500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(manualLayoutUnsafe?{error:'Manual Large Headline does not fit safely.',code:'NEWS_MANUAL_LAYOUT_UNSAFE'}:{ error: "News rendering failed" }));
  }
}


return handleNewsRequest;
};
