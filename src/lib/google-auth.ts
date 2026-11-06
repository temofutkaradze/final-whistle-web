import { prisma } from '@/lib/db';
import type { GoogleProfile } from '@/lib/google';

export type GoogleSignInResult = { ok: true; userId: string } | { ok: false; reason: 'account_conflict' };

// Only call with the verified profile returned by the server-side Google exchange.
// The provider namespace is fixed to Google's authenticated UserInfo endpoint.
export async function resolveGoogleUser(profile: GoogleProfile): Promise<GoogleSignInResult> {
  const where = { provider_subject: { provider: 'google', subject: profile.subject } };
  try {
    return await prisma.$transaction(async tx => {
      const identity = await tx.authIdentity.findUnique({ where, select: { userId: true } });
      if (identity) return { ok: true as const, userId: identity.userId };

      // An email collision is a denial condition, never permission to sign in or link.
      const collision = await tx.user.findUnique({ where: { email: profile.email }, select: { id: true } });
      if (collision) {
        // Another callback may have committed after our first subject lookup.
        // Only that exact verified identity, never the email match, can authorize login.
        const committed = await tx.authIdentity.findUnique({ where, select: { userId: true } });
        return committed
          ? { ok: true as const, userId: committed.userId }
          : { ok: false as const, reason: 'account_conflict' as const };
      }

      const user = await tx.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          brands: { create: { name: 'My page' } },
          authIdentities: { create: { provider: 'google', subject: profile.subject } },
        },
        select: { id: true },
      });
      return { ok: true as const, userId: user.id };
    });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
    // The failed transaction rolled back. Only a committed binding for THIS verified
    // subject may win a race; never recover by looking up the colliding email.
    const identity = await prisma.authIdentity.findUnique({ where, select: { userId: true } });
    return identity ? { ok: true, userId: identity.userId } : { ok: false, reason: 'account_conflict' };
  }
}
