import { describe, expect, it } from "vitest";
import { LoginLimiter, MAX_PASSWORD, MIN_PASSWORD, hashPassword, hashToken, newSessionToken, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("stores scrypt1$salt$hash with a fresh salt every time", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(a).not.toBe(b);
  });

  it("accepts the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("works with unicode passwords", async () => {
    const stored = await hashPassword("პაროლი-🔐-ñandú");
    expect(await verifyPassword("პაროლი-🔐-ñandú", stored)).toBe(true);
    expect(await verifyPassword("პაროლი-🔐-nandu", stored)).toBe(false);
  });

  it("never accepts anything when there is no stored hash (unknown email)", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    // even the password used for the timing dummy must not log anyone in
    expect(await verifyPassword("dummy-password-for-timing", null)).toBe(false);
  });

  it("refuses malformed or tampered stored values without throwing", async () => {
    const good = await hashPassword("correct horse battery");
    const [, salt, hash] = good.split("$");
    const flipped = hash.slice(0, -1) + (hash.endsWith("0") ? "1" : "0");
    for (const bad of ["", "garbage", "scrypt1$zz$zz", `scrypt2$${salt}$${hash}`, `scrypt1$${salt}$${hash.slice(2)}`, `scrypt1$$${hash}`, `scrypt1$${salt}$${flipped}`]) {
      expect(await verifyPassword("correct horse battery", bad)).toBe(false);
    }
  });

  it("keeps the documented limits", () => {
    expect(MIN_PASSWORD).toBe(8);
    expect(MAX_PASSWORD).toBe(200);
  });
});

describe("session tokens", () => {
  it("are 256-bit random values in base64url, never repeated", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are stored only as a SHA-256 hash", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const t = newSessionToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).not.toBe(hashToken(newSessionToken()));
  });
});

describe("LoginLimiter", () => {
  it("blocks a key after too many failures, but only that key", () => {
    const l = new LoginLimiter(3, 1000);
    for (let i = 0; i < 3; i++) {
      expect(l.allowed("a@x.com")).toBe(true);
      l.fail("a@x.com");
    }
    expect(l.allowed("a@x.com")).toBe(false);
    expect(l.allowed("b@x.com")).toBe(true);
  });

  it("forgets failures after the time window", () => {
    let now = 0;
    const l = new LoginLimiter(2, 1000, () => now);
    l.fail("a");
    l.fail("a");
    expect(l.allowed("a")).toBe(false);
    now = 1001;
    expect(l.allowed("a")).toBe(true);
    l.fail("a"); // a new window starts with a count of 1
    expect(l.allowed("a")).toBe(true);
    l.fail("a");
    expect(l.allowed("a")).toBe(false);
  });

  it("reset clears the failures (successful login)", () => {
    const l = new LoginLimiter(1, 1000);
    l.fail("a");
    expect(l.allowed("a")).toBe(false);
    l.reset("a");
    expect(l.allowed("a")).toBe(true);
  });

  it("uses the documented defaults (8 failures per 15 minutes)", () => {
    const l = new LoginLimiter();
    expect(l.max).toBe(8);
    expect(l.windowMs).toBe(15 * 60 * 1000);
  });
});
