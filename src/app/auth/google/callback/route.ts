import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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

  // Google confirmed that this email belongs to the person, so an existing account with the same email is
  // simply logged in (this also lets old test accounts without a password in). Otherwise create the account.
  let user = await prisma.user.findUnique({ where: { email: profile.email } });
  if (!user) {
    try {
      user = await prisma.user.create({
        data: { email: profile.email, name: profile.name, brands: { create: { name: "My page" } } },
      });
    } catch {
      user = await prisma.user.findUnique({ where: { email: profile.email } }); // two sign-ins at the same moment
    }
  }
  if (!user) redirect("/login?error=google");

  await createSession(user.id);
  redirect("/dashboard");
}
