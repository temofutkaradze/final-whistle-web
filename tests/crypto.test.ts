import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, userBotToken } from "@/lib/crypto";
import { decryptSecret as decryptMjs, encryptSecret as encryptMjs } from "../scripts/lib/crypto.mjs";

const SECRET = "test-secret-with-more-than-16-chars";

beforeEach(() => vi.stubEnv("APP_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("bot token encryption (src/lib/crypto.ts)", () => {
  it("round-trips any text", () => {
    for (const plain of ["123456:ABC-def_GHI", "", "ä🔐 unicode", "x".repeat(5000)]) {
      expect(decryptSecret(encryptSecret(plain))).toBe(plain);
    }
  });

  it("uses a new random IV every time and never stores the plain text", () => {
    const a = encryptSecret("123456:ABC");
    const b = encryptSecret("123456:ABC");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    expect(a).not.toContain("123456");
    // iv(12) + tag(16) + ciphertext
    expect(Buffer.from(a.slice(3), "base64").length).toBe(12 + 16 + "123456:ABC".length);
  });

  it("detects tampering and the wrong secret", () => {
    const stored = encryptSecret("123456:ABC");
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret("v1:" + raw.toString("base64"))).toThrow();
    vi.stubEnv("APP_SECRET", "a-completely-different-secret-value");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("refuses unknown formats and a missing or too short APP_SECRET", () => {
    expect(() => decryptSecret("v2:AAAA")).toThrow("Unknown secret format");
    expect(() => decryptSecret("plain-token")).toThrow("Unknown secret format");
    vi.stubEnv("APP_SECRET", "short");
    expect(() => encryptSecret("x")).toThrow(/APP_SECRET/);
    vi.stubEnv("APP_SECRET", "");
    expect(() => encryptSecret("x")).toThrow(/APP_SECRET/);
  });

  it("userBotToken decrypts the customer's own token, or gives undefined", () => {
    expect(userBotToken({ botToken: null })).toBeUndefined();
    expect(userBotToken({ botToken: encryptSecret("999:XYZ") })).toBe("999:XYZ");
  });
});

// The site (TypeScript) and the bot/worker (.mjs) each have their own copy of this code.
// If they ever drift apart, tokens saved by the website could no longer be read by the bot. This test catches that.
describe("the website and the bot/worker read each other's encrypted tokens", () => {
  it("website -> bot", () => expect(decryptMjs(encryptSecret("111:AAA-bbb"))).toBe("111:AAA-bbb"));
  it("bot -> website", () => expect(decryptSecret(encryptMjs("222:CCC-ddd"))).toBe("222:CCC-ddd"));
});
