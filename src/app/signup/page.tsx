import Image from "next/image";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { LEAGUES } from "@/lib/leagues";
import { createSession, getCurrentUser } from "@/lib/auth";
import { MAX_PASSWORD, MIN_PASSWORD, hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAccount(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const brandName = String(formData.get("brandName") ?? "").trim();
  const backgroundUrl = String(formData.get("backgroundUrl") ?? "").trim();
  const leagueIds = formData
    .getAll("leagues")
    .map((v) => Number(v))
    .filter((id) => LEAGUES.some((l) => l.id === id));

  if (!EMAIL_RE.test(email)) redirect("/signup?error=email");
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) redirect("/signup?error=password");
  if (!brandName) redirect("/signup?error=brand");
  if (leagueIds.length === 0) redirect("/signup?error=leagues");
  if (backgroundUrl && !/^https?:\/\//i.test(backgroundUrl)) redirect("/signup?error=background");

  // An existing email is never taken over: nobody has proved that the email is theirs yet.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect(existing.passwordHash ? "/signup?error=exists" : "/signup?error=legacy");

  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash: await hashPassword(password) },
  });

  await prisma.brand.create({
    data: { userId: user.id, name: brandName, backgroundUrl: backgroundUrl || null },
  });
  await prisma.subscription.create({
    data: { userId: user.id, leagueIds },
  });

  await createSession(user.id);
  redirect("/dashboard");
}

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  password: `The password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters long.`,
  exists: "An account with this email already exists. Please log in.",
  legacy:
    "This email belongs to an old test account without a password. Delete it in `npm run db:studio` or use another email.",
  brand: "Please enter the name of your page.",
  leagues: "Choose at least one league.",
  background: "The background must be a link starting with http:// or https://.",
};

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <div className="container auth">
      <div className="card">
      <h1>Create your account</h1>
      <p className="lead">Tell us which page the posts are for and which leagues you follow.</p>
      {error && ERRORS[error] && <p className="error">{ERRORS[error]}</p>}
      <form action={createAccount}>
        <label htmlFor="email">
          Email
          <input id="email" name="email" type="email" required autoComplete="email" />
        </label>
        <label htmlFor="password">
          Password <small>(at least {MIN_PASSWORD} characters)</small>
          <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} autoComplete="new-password" />
        </label>
        <label htmlFor="name">
          Your name <small>(optional)</small>
          <input id="name" name="name" type="text" autoComplete="name" />
        </label>
        <label htmlFor="brandName">
          Page name shown on the image
          <input id="brandName" name="brandName" type="text" required maxLength={60} placeholder="e.g. your page" />
          <small>Printed on every post. You can change it later.</small>
        </label>
        <label htmlFor="backgroundUrl">
          Background image link <small>(optional, https://…)</small>
          <input id="backgroundUrl" name="backgroundUrl" type="url" placeholder="https://" />
        </label>
        <fieldset>
          <legend>Leagues</legend>
          <div className="chips">
          {LEAGUES.map((l) => (
            <label key={l.id} className="check" htmlFor={`league-${l.id}`}>
              <input id={`league-${l.id}`} type="checkbox" name="leagues" value={l.id} />
              {l.name}
            </label>
          ))}
          </div>
        </fieldset>
        <button type="submit">Create account</button>
        <p className="muted">No card needed. You can delete your account at any time.</p>
      </form>
      <p className="muted center" style={{ marginTop: 24 }}>
        Already have an account? <a href="/login">Log in</a>
      </p>
      </div>
      <aside className="auth-aside">
        <Image src="/examples/post-bayern-dortmund.jpg" alt="Example result post: Bayern Munich 4-0 Dortmund" width={720} height={900} />
        <p>Your post, made automatically.</p>
      </aside>
    </div>
  );
}
