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

declare module "*/scripts/lib/worker-core.mjs" {
  export function classifyError(e: unknown): "transient" | "permanent";
  export function createBackoff(o: { baseMs: number; maxMs: number }): {
    ready(key: string, now: number): boolean;
    fail(key: string, now: number): number;
    wait(key: string, now: number, ms: number): void;
    ok(key: string): void;
    retire(keys:Set<string>,now:number): void;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createWorkerCore(deps: any): {
    tick(): Promise<void>;
    expireOld(): Promise<void>;
    recoverStuck(o?: { all?: boolean }): Promise<number>;
    cleanup(): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notify(user: any, text: string): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _state: any;
  };
}

declare module "*/scripts/lib/selection.mjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function toggleSelection(o: { prisma: any; userId: string; fixtureId: number; maxAgeHours: number; now?: number }): Promise<{ result: "no-match" | "already-sent" | "sending" | "too-old" | "removed" | "selected" }>;
}

declare module "*/scripts/lib/poller.mjs" {
  export function shouldRestart(entry: { failed?: boolean; retryAt?: number; blocked?: boolean } | undefined, now: number): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function runPoller(entry: any, deps: any): Promise<void>;
}

declare module "*/next.config.mjs" {
  const config: {
    poweredByHeader?: boolean;
    experimental?: { serverActions?: { bodySizeLimit?: string } };
    headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
  };
  export default config;
}

declare module "*/scripts/lib/background-files.mjs" {
  export function withBackgroundFile<T>(db: any, file: string, work: (tx: any, resolved: string) => Promise<T>): Promise<T>;
  export function assignPendingBackground(db: any, userId: string, file: string, fixtureId: number | "all"): Promise<{count:number}>;
  export function deleteUnusedBackground(db: any, file: string, io?: any): Promise<boolean>;
}

declare module "*/scripts/lib/telegram.mjs" {
 export const MAX_TELEGRAM_IMAGE:number;
 export function readTelegramImage(response:Response,limit?:number):Promise<Buffer>;
 export function makeTelegram(token:string):any;
 export function telegramForUser(user:any):any;
}
declare module "*/scripts/lib/idle-cache.mjs" {
 export function createIdleCache(options?:{max?:number;ttlMs?:number;now?:()=>number}):{get(key:string):any;set(key:string,value:any):void;readonly size:number;prune():void};
 export function retireCooldowns(entries:Map<string,number>,wanted:Map<string,unknown>,now?:number):void;
}
