// Shared settings for bot.mjs and worker.mjs.

// Same favorite leagues as the n8n workflow. Add more for testing with
// EXTRA_LEAGUES="307" in .env (comma separated), then remove it again.
const extra = (process.env.EXTRA_LEAGUES ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

export const FAVORITE_LEAGUES = new Set([39, 140, 135, 78, 61, 2, 5, ...extra]);

// Day boundaries and kickoff times shown to the customer. Demo default = your time zone.
export const TZ = process.env.DISPLAY_TZ || "Asia/Tbilisi";

export const DELAY_MINUTES = 110; // wait this long after kickoff before the first check
export const MAX_AGE_HOURS = 24; // give up on a match this long after kickoff
export const CHECK_INTERVAL_MIN = 10; // ask the API about a match at most this often
export const CLEANUP_AFTER_HOURS = 48; // matches older than this are deleted from our DB
export const DAILY_API_LIMIT = Number(process.env.DAILY_API_LIMIT || 90); // free plan = 100/day

export const FINISHED = new Set(["FT", "AET", "PEN"]);
export const DEAD = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

export const MAX_ATTEMPTS = 5;
export const RETRY_DELAY_MIN = 5;
