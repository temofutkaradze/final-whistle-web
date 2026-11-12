import { describe, expect, it, vi } from "vitest";
import { LEAGUES, leagueName } from "@/lib/leagues";
import * as config from "../scripts/lib/config.mjs";
import { formatKickoff, isDead, isFinished, isValidTimeZone, localDate, localDayRange, startOfLocalDay, utcDate } from "../scripts/lib/football.mjs";

// football.mjs opens a database connection when it loads. These tests only need its pure time functions.
vi.mock("../scripts/lib/db.mjs", () => ({ prisma: {} }));

const iso = (d: Date) => d.toISOString();

describe("a customer's local day (time zones)", () => {
  it("localDate uses the customer's zone, not UTC", () => {
    expect(localDate(new Date("2026-10-09T21:00:00Z"), "Asia/Tbilisi")).toBe("2026-10-10"); // UTC+4
    expect(localDate(new Date("2026-10-09T21:00:00Z"), "UTC")).toBe("2026-10-09");
    expect(localDate(new Date("2026-10-10T03:00:00Z"), "America/New_York")).toBe("2026-10-09"); // UTC-4
  });

  it("formatKickoff shows the hour and minute in that zone", () => {
    expect(formatKickoff("2026-10-10T16:30:00Z", "Asia/Tbilisi")).toBe("20:30");
    expect(formatKickoff(new Date("2026-10-10T16:30:00Z"), "UTC")).toBe("16:30");
  });

  it("utcDate is the UTC calendar day", () => {
    expect(utcDate("2026-10-10T23:59:59Z")).toBe("2026-10-10");
    expect(utcDate(new Date("2026-10-11T00:00:00Z"))).toBe("2026-10-11");
  });

  it("startOfLocalDay is the exact UTC moment the local day begins", () => {
    expect(iso(startOfLocalDay("2026-10-10", "Asia/Tbilisi"))).toBe("2026-10-09T20:00:00.000Z");
    expect(iso(startOfLocalDay("2026-10-10", "UTC"))).toBe("2026-10-10T00:00:00.000Z");
    expect(iso(startOfLocalDay("2026-10-10", "America/New_York"))).toBe("2026-10-10T04:00:00.000Z");
  });

  it("a day in Tbilisi touches two UTC days (matches are stored per UTC day)", () => {
    const r = localDayRange("Asia/Tbilisi", new Date("2026-10-10T12:00:00Z"));
    expect(r.date).toBe("2026-10-10");
    expect(iso(r.start)).toBe("2026-10-09T20:00:00.000Z");
    expect(iso(r.end)).toBe("2026-10-10T20:00:00.000Z");
    expect(r.utcDates).toEqual(["2026-10-09", "2026-10-10"]);
  });

  it("a day in UTC touches exactly one UTC day", () => {
    const r = localDayRange("UTC", new Date("2026-10-10T12:00:00Z"));
    expect(r.utcDates).toEqual(["2026-10-10"]);
    expect(r.end.getTime() - r.start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("handles the day clocks go back (London, 25 October 2026): 25 hours long", () => {
    const r = localDayRange("Europe/London", new Date("2026-10-25T12:00:00Z"));
    expect(r.date).toBe("2026-10-25");
    expect(iso(r.start)).toBe("2026-10-24T23:00:00.000Z"); // midnight was still summer time
    expect(iso(r.end)).toBe("2026-10-26T00:00:00.000Z");
    expect((r.end.getTime() - r.start.getTime()) / 3600000).toBe(25);
  });

  it("handles the day clocks go forward (New York, 8 March 2026): 23 hours long", () => {
    const r = localDayRange("America/New_York", new Date("2026-03-08T18:00:00Z"));
    expect(r.date).toBe("2026-03-08");
    expect(iso(r.start)).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(r.end)).toBe("2026-03-09T04:00:00.000Z");
    expect((r.end.getTime() - r.start.getTime()) / 3600000).toBe(23);
  });

  it("the ranges of consecutive days join up without a gap or overlap", () => {
    for (const tz of ["Asia/Tbilisi", "Europe/London", "America/New_York", "Australia/Lord_Howe", "Pacific/Auckland"]) {
      let day = new Date("2026-03-20T12:00:00Z");
      let previousEnd: number | null = null;
      for (let i = 0; i < 220; i++) {
        const r = localDayRange(tz, day);
        if (previousEnd !== null) expect(r.start.getTime(), `${tz} day ${i}`).toBe(previousEnd);
        previousEnd = r.end.getTime();
        day = new Date(r.end.getTime() + 12 * 3600 * 1000);
      }
    }
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone("Asia/Tbilisi")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Nope/Zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("match status and settings", () => {
  it("knows which statuses mean a finished or a dead match", () => {
    for (const s of ["FT", "AET", "PEN"]) expect(isFinished(s), s).toBe(true);
    for (const s of ["NS", "1H", "HT", "2H", "ET", "LIVE", "PST"]) expect(isFinished(s), s).toBe(false);
    for (const s of ["PST", "CANC", "ABD", "AWD", "WO"]) expect(isDead(s), s).toBe(true);
    for (const s of ["FT", "NS", "1H"]) expect(isDead(s), s).toBe(false);
    for (const s of config.FINISHED) expect(config.DEAD.has(s)).toBe(false);
  });

  it("keeps the free-plan protections (100 requests a day, check rhythm)", () => {
    expect(config.DAILY_API_LIMIT).toBeLessThan(100);
    expect(config.DELAY_MINUTES).toBe(110);
    expect(config.CHECK_INTERVAL_MIN).toBe(10);
    expect(config.MAX_AGE_HOURS * 60).toBeGreaterThan(config.DELAY_MINUTES);
    expect(config.CLEANUP_AFTER_HOURS).toBeGreaterThan(config.MAX_AGE_HOURS);
    expect(config.MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
  });

  it("the leagues of the website and the leagues of the bot/worker are the same list", () => {
    // src/lib/leagues.ts (dashboard) and scripts/lib/config.mjs (bot, worker) each keep their own copy
    for (const l of LEAGUES) expect(config.FAVORITE_LEAGUES.has(l.id), `${l.name} (${l.id}) missing in config.mjs`).toBe(true);
    const ids = LEAGUES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LEAGUES) expect(l.name.trim()).not.toBe("");
    expect(leagueName(39)).toBe("Premier League");
    expect(leagueName(99999)).toBe("League 99999");
  });
});
