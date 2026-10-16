import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, loginLimiter } from "@/lib/auth";
import { MAX_PASSWORD, verifyPassword } from "@/lib/password";
import GoogleButton from "@/app/google-button";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!loginLimiter.allowed(email)) redirect("/login?error=wait");

  const user = email && password.length <= MAX_PASSWORD ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = await verifyPassword(password.slice(0, MAX_PASSWORD), user?.passwordHash ?? null);
  if (!user || !ok) {
    loginLimiter.fail(email);
    redirect("/login?error=bad");
  }

  loginLimiter.reset(email);
  await createSession(user.id);
  redirect("/dashboard");
}

const ERRORS: Record<string, string> = {
  bad: "Wrong email or password.",
  wait: "Too many wrong attempts. Please try again in 15 minutes.",
  google: "Google sign-in did not work. Please try again.",
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
          {deleted === "1" && <p className="alert ok">Your account and its data were deleted.</p>}
          {error && ERRORS[error] && <p className="alert">{ERRORS[error]}</p>}
          <GoogleButton />
          <form action={login}>
            <label htmlFor="email">
              Email
              <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
            </label>
            <label htmlFor="password">
              Password
              <input id="password" name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit">Log in</button>
          </form>
        </div>
        <p className="auth-switch">
          New here? <a href="/signup">Create an account</a>
        </p>
        <p className="auth-note">Demo build: there is no password reset yet.</p>
      </div>
    </div>
  );
}
