import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { LoginLimiter, hashToken, newSessionToken } from "@/lib/password";

// Login sessions: a random token in an HttpOnly cookie, its SHA-256 in the Session table.

export const SESSION_COOKIE = "fw_session";
const SESSION_DAYS = 30;

// Survives hot reloads of `npm run dev`.
const g = globalThis as unknown as { __fwLoginLimiter?: LoginLimiter };
export const loginLimiter: LoginLimiter = (g.__fwLoginLimiter ??= new LoginLimiter());

export async function createSession(userId: string): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // tidy up old sessions
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

// The logged-in user, or null. Only reads the cookie (safe to call from pages and layouts).
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function destroySession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  await clearSessionCookie();
}
