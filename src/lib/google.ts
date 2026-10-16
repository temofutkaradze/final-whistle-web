import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// "Continue with Google": OAuth 2.0 authorization-code flow with PKCE (S256) and a state value.
// Only the basic scopes (openid email profile) are requested, so no Google app verification is needed.
// No extra packages. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (see README).

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const OAUTH_COOKIE = "fw_oauth";

// The button and the routes stay off until both values are set.
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Optional APP_URL (e.g. the real domain later); otherwise the address the request came to.
export function appOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim();
  return (configured || new URL(requestUrl).origin).replace(/\/+$/, "");
}

export function redirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function sameValue(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export type GoogleProfile = { email: string; name: string | null };

// Only an email that Google itself says is verified is accepted.
export function parseProfile(info: unknown): GoogleProfile | null {
  if (!info || typeof info !== "object") return null;
  const o = info as Record<string, unknown>;
  const verified = o.email_verified === true || o.email_verified === "true";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  if (!verified || !email.includes("@") || email.length > 254) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : null;
  return { email, name };
}

// Trades the one-time code for the signed-in person's verified profile. Throws on any problem.
export async function exchangeCodeForProfile(
  args: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchFn: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const tokenRes = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!tokenRes.ok || typeof tokens?.access_token !== "string") throw new Error(`Google token request failed (${tokenRes.status})`);

  const infoRes = await fetchFn(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!infoRes.ok) throw new Error(`Google userinfo request failed (${infoRes.status})`);
  const profile = parseProfile(await infoRes.json().catch(() => null));
  if (!profile) throw new Error("Google did not return a verified email address");
  return profile;
}
