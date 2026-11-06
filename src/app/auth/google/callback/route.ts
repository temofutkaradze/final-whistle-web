import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveGoogleUser, type GoogleSignInResult } from "@/lib/google-auth";
import { createSession } from "@/lib/auth";
import { OAUTH_COOKIE, appOrigin, exchangeCodeForProfile, googleConfigured, redirectUri, sameValue, type GoogleProfile } from "@/lib/google";

export const dynamic = "force-dynamic";

// Step 2: Google sends the visitor back here with ?code=...&state=...
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleConfigured() || !clientId || !clientSecret) redirect("/login?error=google_off");

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  const store = await cookies();
  const saved = store.get(OAUTH_COOKIE)?.value ?? "";
  store.set(OAUTH_COOKIE, "", { path: "/auth/google", maxAge: 0 }); // one use only

  const [savedState, verifier] = saved.split(".");
  if (params.get("error") || !code || !state || !savedState || !verifier || !sameValue(savedState, state)) {
    redirect("/login?error=google");
  }

  let profile: GoogleProfile | null = null;
  try {
    profile = await exchangeCodeForProfile({ code, verifier, clientId, clientSecret, redirectUri: redirectUri(appOrigin(request.url)) });
  } catch (e) {
    console.error("Google sign-in failed:", e instanceof Error ? e.message : e);
  }
  if (!profile) redirect("/login?error=google");

  let result: GoogleSignInResult;
  try {
    result = await resolveGoogleUser(profile);
  } catch {
    // Do not expose database details or fall back to email if identity storage is unavailable.
    console.error('Google identity resolution failed.');
    redirect('/login?error=google');
  }
  if (!result.ok) redirect('/login?error=google_account');

  await createSession(result.userId);
  redirect("/dashboard");
}
