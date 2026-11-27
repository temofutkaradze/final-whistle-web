const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"]);

// "transient": nobody is to blame and waiting helps (server not running, network, rate limit, 5xx).
// "permanent": the same attempt will fail again (blocked bot, chat gone, bad token, broken template...).
export function classifyError(e) {
  const code = e?.cause?.code ?? e?.code;
  const msg = String(e?.message ?? e ?? "");
  if (code && NETWORK_CODES.has(code)) return "transient";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "transient";
  if (/fetch failed|network|socket hang up|timed? ?out|timeout|ECONNREFUSED|ECONNRESET/i.test(msg)) return "transient";
  if (/too many requests|retry after|bad gateway|service unavailable|gateway time-?out|\bHTTP (429|502|503|504)\b/i.test(msg)) return "transient";
  return "permanent";
}

// Growing pauses per key: base, 2x, 4x ... up to max. ok(key) forgets the failures.
export function createBackoff({ baseMs, maxMs }) {
  const state = new Map(); // key -> { failures, until }
  return {
    ready(key, now) {
      const s = state.get(key);
      return !s || now >= s.until;
    },
    fail(key, now) {
      const failures = (state.get(key)?.failures ?? 0) + 1;
      const delay = Math.min(baseMs * 2 ** (failures - 1), maxMs);
      state.set(key, { failures, until: now + delay });
      return delay;
    },
    wait(key, now, ms) {
      state.set(key, { failures: state.get(key)?.failures ?? 0, until: now + ms });
    },
    ok(key) {
      state.delete(key);
    },
    retire(liveKeys, now) {
      for(const [key,entry] of state)if(!liveKeys.has(key)&&now>=entry.until)state.delete(key);
    },
  };
}
