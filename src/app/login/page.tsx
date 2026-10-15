import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, loginLimiter } from "@/lib/auth";
import { MAX_PASSWORD, verifyPassword } from "@/lib/password";

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
      <div className="card">
      <h1>Log in</h1>
      {deleted === "1" && <p className="notice">Your account and its data were deleted.</p>}
      {error && ERRORS[error] && <p className="error">{ERRORS[error]}</p>}
      <form action={login}>
        <label htmlFor="email">
          Email
          <input id="email" name="email" type="email" required autoComplete="email" />
        </label>
        <label htmlFor="password">
          Password
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit">Log in</button>
      </form>
      <p>
        No account yet? <a href="/signup">Create one</a>.
      </p>
      <p className="notice">
        Demo build. There is no password reset yet. Accounts created before passwords existed cannot log in; create a
        new one with another email.
      </p>
      </div>
    </div>
  );
}
