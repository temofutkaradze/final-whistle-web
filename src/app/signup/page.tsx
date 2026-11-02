import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser } from "@/lib/auth";
import { MAX_PASSWORD, MIN_PASSWORD, hashPassword } from "@/lib/password";
import GoogleButton from "@/app/google-button";
import SubmitButton from "@/app/submit-button";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAccount(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email)) redirect("/signup?error=email");
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) redirect("/signup?error=password");

  // An existing email is never taken over: nobody has proved that the email is theirs yet.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect(existing.passwordHash ? "/signup?error=exists" : "/signup?error=legacy");

  // Only the basics here. The page name, the Telegram bot and the leagues are set on the dashboard.
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), brands: { create: { name: "My page" } } },
  });

  await createSession(user.id);
  redirect("/dashboard");
}

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  password: `The password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters long.`,
  exists: "An account with this email already exists. Please log in.",
  legacy: "This email belongs to an old test account without a password. Use Continue with Google with the same email, or another email.",
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
      <div className="auth-box">
        <h1>Create your account</h1>
        <p className="lead">Free while we test. No card needed.</p>
        <div className="card auth-card">
          {error && ERRORS[error] && (
            <p className="alert" role="alert" id="signup-error">
              {ERRORS[error]}
            </p>
          )}
          <GoogleButton />
          <form action={createAccount}>
            <label htmlFor="email">
              Email
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                aria-invalid={error === "email" || error === "exists" || error === "legacy"}
                aria-describedby={error && ERRORS[error] && error !== "password" ? "signup-error" : undefined}
              />
            </label>
            <label htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD}
                maxLength={MAX_PASSWORD}
                autoComplete="new-password"
                aria-invalid={error === "password"}
                aria-describedby={`password-hint${error === "password" ? " signup-error" : ""}`}
              />
              <small id="password-hint">At least {MIN_PASSWORD} characters.</small>
            </label>
            <SubmitButton label="Create account" pendingLabel="Creating account..." />
          </form>
        </div>
        <p className="auth-switch">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
        <p className="auth-note">Next you will connect your Telegram bot and choose your leagues.</p>
      </div>
    </div>
  );
}
