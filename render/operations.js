'use strict';

// Share work only while it is running; never retain results or a growing URL history.
function createSingleFlight(limit = 16) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error('Invalid single-flight limit');
  const pending = new Map();
  return {
    get size() { return pending.size; },
    run(key, work) {
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= limit) return Promise.resolve().then(work);
      const task = Promise.resolve().then(work).finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
      pending.set(key, task);
      return task;
    },
  };
}

// Fixed route buckets and bounded successful-request latency samples. No payloads/identities.
function createMetrics(window = 200) {
  if (!Number.isInteger(window) || window < 1 || window > 200) throw new Error('Invalid metrics window');
  const started = Date.now();
  const buckets = Object.fromEntries(['match', 'news'].map(kind => [kind, {
    succeeded: 0, failed: 0, rejected: 0, cancelled: 0, durations: [],
  }]));
  return {
    record(kind, status, elapsed, cancelled = false) {
      const bucket = buckets[kind];
      if (!bucket) throw new Error('Unknown render route');
      if (cancelled) bucket.cancelled++;
      else if (status >= 500 && status !== 503) bucket.failed++;
      else if (status >= 400) bucket.rejected++;
      else {
        bucket.succeeded++;
        if (bucket.durations.length === window) bucket.durations.shift();
        bucket.durations.push(Math.max(0, Math.round(elapsed)));
      }
    },
    snapshot() {
      const routes = {};
      for (const [kind, bucket] of Object.entries(buckets)) {
        const values = [...bucket.durations].sort((a, b) => a - b);
        const percentile = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
        const {durations, ...counts} = bucket;
        routes[kind] = {...counts, samples: values.length, p50_ms: percentile(.5), p95_ms: percentile(.95)};
      }
      return {uptime_s: Math.floor((Date.now() - started) / 1000), window, routes};
    },
  };
}

// One timer per page. Expiry closes only that page, never its context/shared browser.
// The timer covers browser work, not output encoding/writing, which must finish atomically for callers.
async function withPageDeadline(page, work, timeoutMs = 300_000) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Render page deadline exceeded'), {code: 'RENDER_PAGE_DEADLINE'}));
      Promise.resolve().then(() => page.close()).catch(() => {});
    }, timeoutMs);
    timer.unref?.();
  });
  try { return await Promise.race([Promise.resolve().then(work), expired]); }
  finally { clearTimeout(timer); }
}

function createCapturePolicy() {
  let failures = 0;
  let enabled = true;
  return {
    get enabled() { return enabled; },
    success() { if (enabled) failures = 0; },
    failure(error) {
      // Closing/crashing/timing out a request says nothing about CDP capability.
      if (error && /timed?\s*out|timeout|closed|disconnect|crash|deadline/i.test(String(error.message))) return false;
      if (!enabled) return false;
      failures = Math.min(3, failures + 1);
      if (failures === 3) { enabled = false; return true; }
      return false;
    },
  };
}

// Track admitted HTTP work, including existing queue waiters. Draining never aborts them.
function createDrainTracker() {
  let draining = false, active = 0, idle, resolveIdle;
  return {
    get draining() { return draining; },
    get active() { return active; },
    begin() {
      if (draining) return null;
      active++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        active--;
        if (!active) resolveIdle?.();
      };
    },
    drain() {
      draining = true;
      if (!active) return Promise.resolve();
      return idle ??= new Promise(resolve => { resolveIdle = resolve; });
    },
  };
}

module.exports = {createSingleFlight, createMetrics, withPageDeadline, createCapturePolicy, createDrainTracker};
