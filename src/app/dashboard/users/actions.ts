"use server";

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { saveTelegramMember } from '../../../../scripts/lib/member-management.mjs';

export async function saveAccess(data: FormData) {
  const owner = await requireUser();
  let success = false;
  try {
    await saveTelegramMember(prisma, owner.id, {
      telegramUserId: String(data.get('telegramUserId') ?? ''),
      displayName: String(data.get('displayName') ?? ''),
      status: String(data.get('status') ?? ''),
      matchAccess: data.get('matchAccess') === 'on',
      newsAccess: data.get('newsAccess') === 'on',
    });
    success = true;
  } catch { /* Do not expose database errors or private account metadata. */ }
  redirect('/dashboard/users?' + (success ? 'saved=1' : 'error=1'));
}
