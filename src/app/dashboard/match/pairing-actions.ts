'use server';
import {revalidatePath} from 'next/cache';
import {requireUser} from '@/lib/auth';
import {prisma} from '@/lib/db';
import {reviewMatchChallenge,confirmMatchChallenge} from '../../../../scripts/lib/match-pairing.mjs';
export type PairingState={error?:string;success?:string;review?:{code:string;telegramUserId:string;chatId:string;botUsername:string|null;expiresAt:string}};
export async function reviewPairing(_state:PairingState,form:FormData):Promise<PairingState>{
 const user=await requireUser();const code=String(form.get('code')??'').trim();
 try{const review=await reviewMatchChallenge(prisma,user.id,code);return review?{review:{...review,code}}:{error:'Invalid or expired pairing code for this account and bot. Request a fresh code in your private Telegram chat.'};}
 catch{console.error('[Match pairing] review unavailable');return {error:'Pairing is unavailable. Please try again later.'};}
}
export async function confirmPairing(_state:PairingState,form:FormData):Promise<PairingState>{
 const user=await requireUser();
 if(form.get('confirm')!=='yes')return {error:'Explicitly confirm the Telegram identity first.'};
 try{
  const ok=await confirmMatchChallenge(prisma,user.id,String(form.get('code')??'').trim());
  if(!ok)return {error:'Pairing was not approved. The code expired, was used, or conflicts with an existing binding. Request a fresh code or disconnect the existing bot first.'};
  revalidatePath('/dashboard/match');return {success:'Telegram pairing approved.'};
 }catch{console.error('[Match pairing] confirmation unavailable');return {error:'Pairing is unavailable. Nothing was approved.'};}
}
