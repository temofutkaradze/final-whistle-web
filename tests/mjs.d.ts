// Types for the plain .mjs files of the bot and the worker, so the tests can import them with full type checking.

declare module "*/scripts/lib/events.mjs" {
  export function buildEventsHtml(
    rawEvents: unknown,
    match: { home_team: string; away_team: string; home_score: number; away_score: number },
  ): { home_events_html: string; away_events_html: string; total_events: number };
}

declare module "*/scripts/lib/crypto.mjs" {
  export function encryptSecret(plain: string): string;
  export function decryptSecret(stored: string): string;
}

declare module "*/scripts/lib/config.mjs" {
  export const FAVORITE_LEAGUES: Set<number>;
  export const TZ: string;
  export const DELAY_MINUTES: number;
  export const MAX_AGE_HOURS: number;
  export const CHECK_INTERVAL_MIN: number;
  export const CLEANUP_AFTER_HOURS: number;
  export const DAILY_API_LIMIT: number;
  export const FINISHED: Set<string>;
  export const DEAD: Set<string>;
  export const MAX_ATTEMPTS: number;
  export const RETRY_DELAY_MIN: number;
}

declare module "*/scripts/lib/football.mjs" {
  export function localDate(d?: Date, tz?: string): string;
  export function formatKickoff(d: Date | string | number, tz?: string): string;
  export const utcDate: (d: Date | string | number) => string;
  export function startOfLocalDay(dateStr: string, tz: string): Date;
  export function localDayRange(tz?: string, now?: Date): { date: string; start: Date; end: Date; utcDates: string[] };
  export const isValidTimeZone: (tz: string) => boolean;
  export const isFinished: (status: string) => boolean;
  export const isDead: (status: string) => boolean;
}
