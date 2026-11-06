"use server";
import { registerBot, createWithinTemplateQuota } from "@/lib/resource-transactions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { DEFAULT_NEWS_STYLE, normalizeNewsStyle } from "@/lib/news/parse";
import { NEWS_FIELDS } from '@/lib/news/fields';
import { createHash, randomBytes } from 'node:crypto';
import type { LinkState } from './bot-link';


const BUILTINS = [
  { id: "single", name: "Single", layout: "single" },
  { id: "left", name: "Circle Left", layout: "left" },
  { id: "right", name: "Circle Right", layout: "right" },
  { id: "breaking", name: "BREAKING", layout: "breaking" },
];
const LIMIT = 20;
const back = (message: string) => `/news?message=${encodeURIComponent(message)}`;

export async function saveDefault(data: FormData) {
  "use server";
  const user = await requireUser();
  const ref = String(data.get("template") ?? "single");
  const valid = BUILTINS.some((x) => x.id === ref) || Boolean(await prisma.newsTemplate.findFirst({ where: { id: ref, userId: user.id }, select: { id: true } }));
  if (!valid) redirect(back("Invalid template"));
  await prisma.newsSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, defaultTemplateRef: ref }, update: { defaultTemplateRef: ref } });
  redirect(back("Default template saved"));
}

export async function saveTemplate(data: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(data.get("id") ?? "");
  const name = String(data.get("name") ?? "").trim().slice(0, 60);
  const layout = String(data.get("layout") ?? "single");
  if (!name || !BUILTINS.some((b) => b.layout === layout)) redirect(back("Invalid template name or layout"));
  const raw: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_NEWS_STYLE)) raw[key] = String(data.get(key) ?? "");
  for (const field of NEWS_FIELDS) {
    const value = raw[field.key];
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n < field.min || n > field.max) redirect(back(`Invalid ${field.label}`));
  }
  const config = normalizeNewsStyle(raw);
  for (const key of ['font','breakingFont','align','accent','textColor','authorColor','circleBorderColor','circleShape'] as const) {
    if (config[key] !== raw[key]) redirect(back(`Invalid ${key}`));
  }
  if (id) {
    const found = await prisma.newsTemplate.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!found) redirect(back("Template not found"));
    await prisma.newsTemplate.update({ where: { id }, data: { name, layout, config: config as unknown as Prisma.InputJsonObject } });
  } else {
    const created=await createWithinTemplateQuota(prisma,user.id,'news',LIMIT,async tx=>{
      const created=await tx.newsTemplate.create({data:{userId:user.id,name,layout,config:config as unknown as Prisma.InputJsonObject}});
      await tx.newsSettings.upsert({where:{userId:user.id},create:{userId:user.id,defaultTemplateRef:created.id},update:{defaultTemplateRef:created.id}});
      return created;
    });
    if(!created)redirect(back("Maximum 20 custom templates"));
  }
  redirect(back("Template saved"));
}

export async function removeTemplate(data: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(data.get("id") ?? "");
  const found = await prisma.newsTemplate.findFirst({ where: { id, userId: user.id } });
  if (found) {
    await prisma.newsTemplate.delete({ where: { id } });
    await prisma.newsSettings.updateMany({ where: { userId: user.id, defaultTemplateRef: id }, data: { defaultTemplateRef: "single" } });
  }
  redirect(back("Template deleted"));
}

export async function connectNewsBot(data: FormData) {
  "use server";
  const user = await requireUser();
  const token = String(data.get("token") ?? "").trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) redirect(back("Invalid Telegram bot token"));
  let info: { ok?: boolean; result?: { id: number; username?: string } };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    info = await response.json();
  } catch { redirect(back("Telegram could not be reached")); }
  if (!info.ok || !info.result) redirect(back("Telegram rejected this token"));
  if (!info.result.username || !/^\w+$/.test(info.result.username)) redirect(back('Telegram returned an invalid bot username'));
  // Inspect only. Never remove a live n8n webhook or change Telegram services.
  let webhook: {ok?:boolean;result?:{url?:string}};
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {signal:AbortSignal.timeout(15000),cache:'no-store'});
    webhook = await response.json();
  } catch { redirect(back('Could not verify the bot webhook. Try again.')); }
  if (!webhook.ok) redirect(back('Could not verify the bot webhook'));
  if (webhook.result?.url) redirect(back('This bot has a webhook. Connect a separate News bot without a webhook; the existing workflow was not changed.'));
  const botId = String(info.result.id);
  const botUsername=info.result.username;
  let encrypted: string;
  try { encrypted = encryptSecret(token); } catch { redirect(back("APP_SECRET is not configured")); }
  let saved=false;
  try {
    saved=await registerBot(prisma,user.id,botId,'news',tx=>tx.newsSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, botToken: encrypted, botId, botUsername },
    update: { botToken: encrypted, botId, botUsername, telegramChatId: null, linkCodeHash:null,linkExpiresAt:null,pending:Prisma.DbNull,lastUpdateId:null },
    }));
  } catch { redirect(back('Could not save the bot. It may already belong to another account.')); }
  if(!saved)redirect(back('This bot is already connected. Use a separate News bot.'));
  redirect(back("News bot saved. Create a secure Telegram link below to authorize your chat."));
}

export async function createNewsLink(_previous:LinkState, _data:FormData):Promise<LinkState> {
  const user = await requireUser();
  const settings = await prisma.newsSettings.findUnique({where:{userId:user.id},select:{botId:true,botUsername:true,telegramChatId:true}});
  if (!settings?.botId || !settings.botUsername || settings.telegramChatId) return {error:'Connect an unlinked News bot first.'};
  const token = randomBytes(24).toString('hex');
  const saved=await prisma.newsSettings.updateMany({where:{userId:user.id,botId:settings.botId,telegramChatId:null},data:{linkCodeHash:createHash('sha256').update(token).digest('hex'),linkExpiresAt:new Date(Date.now()+10*60_000)}});
  if (!saved.count) return {error:'Connection changed. Refresh this page.'};
  return {url:`https://t.me/${settings.botUsername}?start=${token}`};
}

export async function disconnectNewsBot() {
  "use server";
  const user = await requireUser();
  await prisma.newsSettings.updateMany({ where: { userId: user.id }, data: { botToken: null, botId: null, botUsername: null, telegramChatId: null,linkCodeHash:null,linkExpiresAt:null,pending:Prisma.DbNull,lastUpdateId:null } });
  redirect(back("News bot disconnected"));
}


