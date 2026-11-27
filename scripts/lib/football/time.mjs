// Pure timezone helpers; the configured default stays shared with the bot and worker.
import { TZ } from "../config.mjs";

export function localDate(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d); // "2026-10-10"
}

export function formatKickoff(d, tz = TZ) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(d),
  );
}

export const utcDate = (d) => new Date(d).toISOString().slice(0, 10);

// How far ahead of UTC the zone is at this moment (milliseconds).
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The exact moment (UTC) when local day "YYYY-MM-DD" starts in this zone.
export function startOfLocalDay(dateStr, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  let guess = midnightAsUtc;
  for (let i = 0; i < 3; i++) guess = midnightAsUtc - tzOffsetMs(new Date(guess), tz); // twice is enough, 3 is safe around DST
  return new Date(guess);
}

// The customer's "today": { date, start, end, utcDates }  (start inclusive, end exclusive)
export function localDayRange(tz = TZ, now = new Date()) {
  const date = localDate(now, tz);
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const start = startOfLocalDay(date, tz);
  const end = startOfLocalDay(next, tz);
  const utcDates = [...new Set([utcDate(start), utcDate(new Date(end.getTime() - 1))])];
  return { date, start, end, utcDates };
}

export const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
