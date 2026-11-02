import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  appOrigin,
  buildAuthUrl,
  challengeFor,
  exchangeCodeForProfile,
  googleConfigured,
  newState,
  newVerifier,
  parseProfile,
  redirectUri,
  sameValue,
} from "@/lib/google";

// "Continue with Google": the helper functions of the login flow. Google itself is never contacted (a fake fetch stands in).
afterEach(() => vi.unstubAllEnvs());

describe("PKCE and state", () => {
  it("computes the S256 challenge exactly as RFC 7636 says", () => {
    // test vector from RFC 7636, appendix B
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes long random URL-safe verifiers and states", () => {
    const verifiers = new Set(Array.from({ length: 50 }, newVerifier));
    const states = new Set(Array.from({ length: 50 }, newState));
    expect(verifiers.size).toBe(50);
    expect(states.size).toBe(50);
    for (const v of verifiers) expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes; RFC asks for 43 to 128 characters
    for (const s of states) expect(s).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("compares secrets in constant time and never equates different lengths", () => {
    expect(sameValue("abc", "abc")).toBe(true);
    expect(sameValue("abc", "abd")).toBe(false);
    expect(sameValue("abc", "abcd")).toBe(false);
    expect(sameValue("", "")).toBe(true);
  });
});

describe("addresses and settings", () => {
  it("is switched on only when both the client id and the secret are set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    expect(googleConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(googleConfigured()).toBe(true);
  });

  it("uses the address the request came to, or APP_URL when it is set", () => {
    vi.stubEnv("APP_URL", "");
    expect(appOrigin("http://localhost:3000/auth/google?x=1")).toBe("http://localhost:3000");
    vi.stubEnv("APP_URL", " https://example.com/// ");
    expect(appOrigin("http://localhost:3000/auth/google")).toBe("https://example.com");
    expect(redirectUri("https://example.com")).toBe("https://example.com/auth/google/callback");
  });

  it("builds the Google address with PKCE, a state and only the basic scopes", () => {
    const url = new URL(buildAuthUrl({ clientId: "my-id", redirectUri: "http://localhost:3000/auth/google/callback", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "my-id",
      redirect_uri: "http://localhost:3000/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });
});

describe("parseProfile: only a verified email gets in", () => {
  it("accepts a verified email, lower-cased, with a trimmed name", () => {
    expect(parseProfile({ email: "  Demo@Example.COM ", email_verified: true, name: "  Demo User " })).toEqual({ email: "demo@example.com", name: "Demo User" });
    expect(parseProfile({ email: "a@b.co", email_verified: "true" })).toEqual({ email: "a@b.co", name: null });
  });

  it("refuses everything else", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { email: "a@b.co" }, { email: "a@b.co", email_verified: false }, { email: "a@b.co", email_verified: "false" }, { email: "a@b.co", email_verified: 1 }, { email_verified: true }, { email: "no-at-sign", email_verified: true }, { email: 42, email_verified: true }, { email: "a".repeat(250) + "@b.co", email_verified: true }]) {
      expect(parseProfile(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("shortens a very long name and ignores an empty one", () => {
    expect(parseProfile({ email: "a@b.co", email_verified: true, name: "x".repeat(500) })?.name?.length).toBe(120);
    expect(parseProfile({ email: "a@b.co", email_verified: true, name: "   " })?.name).toBeNull();
  });
});

describe("exchangeCodeForProfile", () => {
  const args = { code: "the-code", verifier: "the-verifier", clientId: "id", clientSecret: "secret", redirectUri: "http://localhost:3000/auth/google/callback" };
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("trades the code for a verified profile, sending the PKCE verifier and the secret to the token address only", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url === GOOGLE_TOKEN_URL ? reply({ access_token: "tok" }) : reply({ email: "Me@Example.com", email_verified: true, name: "Me" });
    }) as unknown as typeof fetch;

    expect(await exchangeCodeForProfile(args, fake)).toEqual({ email: "me@example.com", name: "Me" });
    expect(calls.map((c) => c.url)).toEqual([GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL]);
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({ code: "the-code", client_id: "id", client_secret: "secret", redirect_uri: args.redirectUri, grant_type: "authorization_code", code_verifier: "the-verifier" });
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(String(calls[1].init?.body ?? "")).not.toContain("secret");
  });

  it("fails clearly when Google refuses the code, sends no token, or answers with junk", async () => {
    const make = (tokenRes: () => Promise<Response>) => (async (url: string) => (url === GOOGLE_TOKEN_URL ? tokenRes() : reply({ email: "a@b.co", email_verified: true }))) as unknown as typeof fetch;
    await expect(exchangeCodeForProfile(args, make(() => reply({ error: "invalid_grant" }, 400)))).rejects.toThrow(/token request failed \(400\)/);
    await expect(exchangeCodeForProfile(args, make(() => reply({})))).rejects.toThrow(/token request failed/);
    await expect(exchangeCodeForProfile(args, make(() => Promise.resolve(new Response("<html>oops</html>", { status: 200 }))))).rejects.toThrow(/token request failed/);
  });

  it("fails when the userinfo answer is an error or the email is not verified", async () => {
    const withInfo = (info: () => Promise<Response>) => (async (url: string) => (url === GOOGLE_TOKEN_URL ? reply({ access_token: "t" }) : info())) as unknown as typeof fetch;
    await expect(exchangeCodeForProfile(args, withInfo(() => reply({}, 401)))).rejects.toThrow(/userinfo request failed \(401\)/);
    await expect(exchangeCodeForProfile(args, withInfo(() => reply({ email: "a@b.co", email_verified: false })))).rejects.toThrow(/verified email/);
    await expect(exchangeCodeForProfile(args, withInfo(() => Promise.resolve(new Response("not json"))))).rejects.toThrow(/verified email/);
  });

  it("lets a network error through as an error", async () => {
    const down = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(exchangeCodeForProfile(args, down)).rejects.toThrow("network down");
  });
});
