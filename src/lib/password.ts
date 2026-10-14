import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Password hashing, session tokens and a small login limiter.
// Only Node's built-in crypto is used (no extra packages). This file has no Next.js or database imports.

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200; // scrypt is slow on purpose, so very long inputs are refused

const KEYLEN = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// Stored as "scrypt1$<salt hex>$<hash hex>" (a fresh random salt for every password).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt1$${salt.toString("hex")}$${key.toString("hex")}`;
}

let dummyHash: Promise<string> | null = null;

// With no stored hash (unknown email) a dummy hash is checked anyway, so the response time does not
// reveal whether an account exists. The result is always false in that case.
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const hash = stored ?? (await (dummyHash ??= hashPassword("dummy-password-for-timing")));
  const parts = hash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt1") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = await derive(password, salt);
  const same = timingSafeEqual(actual, expected);
  return stored ? same : false;
}

// The browser gets the random token; the database only keeps its SHA-256, so a leaked
// database cannot be used to log in.
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Blocks an email for a while after too many wrong passwords. Kept in memory (enough while testing locally).
export class LoginLimiter {
  max: number;
  windowMs: number;
  now: () => number;
  entries: Map<string, { count: number; first: number }>;

  constructor(max = 8, windowMs = 15 * 60 * 1000, now: () => number = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  allowed(key: string): boolean {
    const e = this.entries.get(key);
    if (!e) return true;
    if (this.now() - e.first > this.windowMs) {
      this.entries.delete(key);
      return true;
    }
    return e.count < this.max;
  }

  fail(key: string): void {
    const e = this.entries.get(key);
    if (!e || this.now() - e.first > this.windowMs) this.entries.set(key, { count: 1, first: this.now() });
    else e.count += 1;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
