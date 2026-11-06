import { authAdmission } from "@/lib/admission";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, loginLimiter } from "@/lib/auth";
import { MAX_EMAIL, MAX_PASSWORD, verifyPassword } from "@/lib/password";
import GoogleButton from "@/app/google-button";
import SubmitButton from "@/app/submit-button";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";

  const rawEmail=formData.get("email");
  if(typeof rawEmail!=='string'||rawEmail.length>MAX_EMAIL)redirect('/login?error=bad');
  const email = rawEmail.trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) redirect("/login?error=bad");
  if (!loginLimiter.allowed(email)) redirect("/login?error=wait");
  const release=authAdmission.acquire(email);
  if(!release)redirect("/login?error=wait");
  try {

  const user = email && password.length <= MAX_PASSWORD ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = await verifyPassword(password.slice(0, MAX_PASSWORD), user?.passwordHash ?? null);
  if (!user || !ok) {
    loginLimiter.fail(email);
    redirect("/login?error=bad");
  }

  loginLimiter.reset(email);
  await createSession(user.id);
  redirect("/dashboard");
  } finally { release(); }
}

const ERRORS: Record<string, string> = {
  bad: "Wrong email or password.",
  wait: "Too many wrong attempts. Please try again in 15 minutes.",
  google: "Google sign-in did not work. Please try again.",
  google_account: "Google sign-in could not be completed for this account. Use your existing sign-in method or contact support.",
  google_off: "Google sign-in is not set up on this server.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { error, deleted } = await searchParams;

  return (
    <div className="container auth">
      <div className="auth-box">
        <h1>Welcome back</h1>
        <p className="lead">Log in to manage your bot and your posts.</p>
        <div className="card auth-card">
          {deleted === "1" && (
            <p className="alert ok" role="status">
              Your account and its data were deleted.
            </p>
          )}
          {error && ERRORS[error] && (
            <p className="alert" role="alert" id="login-error">
              {ERRORS[error]}
            </p>
          )}
          <GoogleButton />
          <form action={login}>
            <label htmlFor="email">
              Email
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={error === "bad"}
                aria-describedby={error && ERRORS[error] ? "login-error" : undefined}
              />
            </label>
            <label htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                aria-invalid={error === "bad"}
                aria-describedby={error && ERRORS[error] ? "login-error" : undefined}
              />
            </label>
            <SubmitButton label="Log in" pendingLabel="Logging in..." />
          </form>
        </div>
        <p className="auth-switch">
          New here? <Link href="/signup">Create account</Link>
        </p>
        <p className="auth-note">Demo build: there is no password reset yet.</p>
      </div>
    </div>
  );
}
