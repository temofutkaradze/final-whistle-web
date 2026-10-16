import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OAUTH_COOKIE, appOrigin, buildAuthUrl, challengeFor, googleConfigured, newState, newVerifier, redirectUri } from "@/lib/google";

export const dynamic = "force-dynamic";

// Step 1: remember a random state + PKCE verifier in a short-lived HttpOnly cookie, then send the visitor to Google.
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleConfigured() || !clientId) redirect("/login?error=google_off");

  const state = newState();
  const verifier = newVerifier();
  (await cookies()).set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: "lax", // the way back from Google is a normal top-level navigation, so the cookie is sent
    secure: process.env.NODE_ENV === "production",
    path: "/auth/google",
    maxAge: 600,
  });

  redirect(buildAuthUrl({ clientId, redirectUri: redirectUri(appOrigin(request.url)), state, challenge: challengeFor(verifier) }));
}
