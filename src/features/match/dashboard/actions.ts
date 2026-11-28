"use server";

import { matchSampleAdmission } from "@/lib/admission";
import { registerBot, createWithinTemplateQuota } from "@/lib/resource-transactions";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendDocument, sendMessage } from "@/lib/telegram";
import { renderSamplePost } from "@/lib/render";
import { MAX_CUSTOM_TEMPLATES, customTemplateId, isBuiltinTemplate } from "@/lib/templates";
import { SITE } from "@/lib/site";
import { prepareTemplateInput } from "@/lib/template-input";
import { MAX_LOGO_UPLOAD, deleteLogoFile, saveLogo } from "@/lib/logos";
import { LEAGUES, FEATURED_MATCH_TEAMS } from "@/lib/leagues";
import { encryptSecret, userBotToken } from "@/lib/crypto";
import { deleteAccountFiles } from "@/lib/backgrounds";
import { clearSessionCookie, requireUser } from "@/lib/auth";
import { approvedMatchUser, lockMatchAccount } from "../../../../scripts/lib/match-pairing.mjs";
import type { SaveState } from "../template-editor/types";

// extra looks like "&bot=ok"; the account comes from the login session, never from the URL.
function back(extra = ""): string {
  const query = extra.replace(/^&/, "");
  return query ? `/dashboard/match?${query}` : "/dashboard/match";
}

export async function sendTest() {
  "use server";
  const user = await requireUser();

  let result = "nochat";
  const approved = await approvedMatchUser(prisma,user.id);
  if (approved) {
    try {
      await sendMessage(approved.telegramChatId, `Test message from ${SITE.name}. Your chat is connected.`, userBotToken(approved) as string);
      result = "ok";
    } catch (e) {
      console.error("sendTest failed:", e);
      result = "fail";
    }
  }
  redirect(back(`&test=${result}`));
}

// Renders a sample post for the user's newest page (sample match, their page name and
// background) with the local render server and sends it to their Telegram chat.
export async function sendSample() {
  "use server";
  const account = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: account.id },
    include: { brands: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!user) redirect("/login");

  let result = "nochat";
  const brand = user.brands[0];
  const approved = await approvedMatchUser(prisma,user.id);
  if (approved && brand) {
    const release=matchSampleAdmission.acquire(user.id);
    if(!release)redirect(back("&sample=fail"));
    try {
      // A customer-made template is read from the database and sent along with the request.
      let templateHtml: string | undefined;
      const customId = customTemplateId(brand.templateRef);
      if (customId) {
        const t = await prisma.template.findFirst({ where: { id: customId, userId: user.id }, select: { html: true } });
        templateHtml = t?.html;
      }
      const jpgPath = await renderSamplePost(brand, templateHtml);
      const current = await approvedMatchUser(prisma,user.id,{botId:approved.botId??undefined,connectionToken:approved.botToken??undefined,identity:{chatId:approved.telegramChatId,telegramUserId:approved.telegramChatId}});
      if(current){await sendDocument(current.telegramChatId, jpgPath, `Sample post for ${brand.name}`, userBotToken(current) as string);result = "ok";}
    } catch (e) {
      console.error("sendSample failed:", e);
      result = "fail";
    } finally { release(); }
  }
  redirect(back(`&sample=${result}`));
}

// Saves the look of the posts: template, page name or logo in the top corner, and the uploaded logo.
export async function saveLook(formData: FormData) {
  "use server";
  const user = await requireUser();
  const brand = await prisma.brand.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  if (!brand) redirect(back("&look=notfound"));

  const templateRaw = String(formData.get("template") ?? "");
  let templateRef = brand.templateRef;
  if (isBuiltinTemplate(templateRaw)) {
    templateRef = templateRaw;
  } else {
    const customId = customTemplateId(templateRaw);
    const own = customId ? await prisma.template.findFirst({ where: { id: customId, userId: user.id }, select: { id: true } }) : null;
    if (own) templateRef = templateRaw;
  }
  let brandMode = String(formData.get("brandMode") ?? "") === "logo" ? "logo" : "text";
  let logoPath = brand.logoPath;

  if (String(formData.get("removeLogo") ?? "") === "1") {
    await deleteLogoFile(logoPath);
    logoPath = null;
  }

  const upload = formData.get("logo");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > MAX_LOGO_UPLOAD) redirect(back("&look=biglogo"));
    const saved = await saveLogo(brand.id, Buffer.from(await upload.arrayBuffer()));
    if (!saved) redirect(back("&look=badlogo"));
    logoPath = saved;
  }

  let result = "saved";
  if (brandMode === "logo" && !logoPath) {
    brandMode = "text";
    result = "nologo";
  }

  await prisma.brand.update({ where: { id: brand.id }, data: { templateRef, brandMode, logoPath } });
  redirect(back(`&look=${result}`));
}

// ---- customer-made templates ----

// Saves a template made with the options form or from pasted / edited HTML. Problems come back as a message shown next to
// the Save button (the form keeps everything the customer typed); success redirects to the template list.
// "overwrite" changes the customer's own template, anything else creates a new one (built-in templates are never changed).
export async function saveTemplate(_prev: SaveState, formData: FormData): Promise<SaveState> {
  "use server";
  const user = await requireUser();
  const prepared = prepareTemplateInput(formData);
  if (!prepared.ok) return { error: prepared.error };
  const { name, html, config } = prepared;
  const configJson = config ? (config as unknown as Prisma.InputJsonObject) : Prisma.DbNull;

  if (String(formData.get("saveMode") ?? "") === "overwrite") {
    const own = await prisma.template.findFirst({ where: { id: String(formData.get("editId") ?? ""), userId: user.id }, select: { id: true } });
    if (own) {
      await prisma.template.update({ where: { id: own.id }, data: { name, html, config: configJson } });
      redirect(back("&look=tplupdated") + "#t-tpl");
    }
  }

  const created = await createWithinTemplateQuota(prisma,user.id,'match',MAX_CUSTOM_TEMPLATES,async tx=>{
    const created=await tx.template.create({data:{userId:user.id,name,html,config:configJson},select:{id:true}});
    const brand=await tx.brand.findFirst({where:{userId:user.id},orderBy:{createdAt:'desc'},select:{id:true}});
    if(brand)await tx.brand.update({where:{id:brand.id},data:{templateRef:'custom:'+created.id}});
    return created;
  });
  if(!created)return {error:`You can have up to ${MAX_CUSTOM_TEMPLATES} own templates. Delete one first, or overwrite an existing one.`};
  redirect(back("&look=tpladded") + "#t-tpl");
}

export async function deleteTemplate(id: string, _formData: FormData) {
  "use server";
  const user = await requireUser();
  const own = await prisma.template.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (own) {
    await prisma.template.delete({ where: { id: own.id } });
    // pages that used it go back to Classic
    await prisma.brand.updateMany({ where: { userId: user.id, templateRef: `custom:${own.id}` }, data: { templateRef: "classic" } });
  }
  redirect(back("&look=tpldeleted"));
}

// Saves the customer's OWN Telegram bot (created with @BotFather). The token is stored encrypted.
export async function connectBot(formData: FormData) {
  "use server";
  const user = await requireUser();
  const token = String(formData.get("token") ?? "").trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) redirect(back("&bot=format"));

  let me: { ok?: boolean; result?: { id: number; username?: string } } | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
    me = await res.json();
  } catch {
    me = null;
  }
  if (!me) redirect(back("&bot=net"));
  if (!me.ok || !me.result) redirect(back("&bot=invalid"));

  let encrypted = "";
  try {
    encrypted = encryptSecret(token);
  } catch {
    redirect(back("&bot=secret"));
  }

  const botId = String(me.result.id);
  const botUsername = me.result.username ?? null;
  // Connection changes invalidate every pending/approved Match pairing atomically.
  const saved=await registerBot(prisma,user.id,botId,'match',async tx=>{
    if(!await lockMatchAccount(tx,user.id))throw new Error('Account unavailable');
    await tx.matchPairingChallenge.deleteMany({where:{userId:user.id}});
    await tx.matchTelegramBinding.deleteMany({where:{userId:user.id}});
    await tx.user.update({
    where: { id: user.id },
    data: {
      botToken: encrypted,
      botId,
      botUsername,
      telegramChatId: null,
      telegramLinkedAt: null,
      linkCode: null,
    },
  });
  });
  if(!saved)redirect(back("&bot=taken"));
  redirect(back("&bot=ok"));
}

export async function disconnectBot() {
  "use server";
  const user = await requireUser();
  await prisma.$transaction(async tx=>{
    if(!await lockMatchAccount(tx,user.id))throw new Error('Account unavailable');
    await tx.matchPairingChallenge.deleteMany({where:{userId:user.id}});
    await tx.matchTelegramBinding.deleteMany({where:{userId:user.id}});
    await tx.user.update({where:{id:user.id},data:{botToken:null,botId:null,botUsername:null,telegramChatId:null,telegramLinkedAt:null}});
  });
  redirect(back("&bot=removed"));
}

// Saves which leagues and clubs the customer follows (used by /matches in Telegram).
export async function saveFilters(formData: FormData) {
  "use server";
  const user = await requireUser();

  const leagueIds = formData
    .getAll("leagues")
    .map((v) => Number(v))
    .filter((id) => LEAGUES.some((l) => l.id === id));
  const wantedTeams = formData.getAll("teams").map((v) => Number(v)).filter((n) => Number.isInteger(n));
  const storedTeams = wantedTeams.length
    ? await prisma.team.findMany({ where: { id: { in: wantedTeams } }, select: { id: true } })
    : [];
  // FavoriteTeam has no Team FK: supported IDs can be followed before their first
  // discovered fixture, without inventing or seeding production Team metadata.
  const teams=[...new Map([...storedTeams,...FEATURED_MATCH_TEAMS.filter(t=>wantedTeams.includes(t.id))].map(t=>[t.id,{id:t.id}])).values()];

  const sub = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  if (sub) await prisma.subscription.update({ where: { id: sub.id }, data: { leagueIds } });
  else await prisma.subscription.create({ data: { userId: user.id, leagueIds } });

  await prisma.favoriteTeam.deleteMany({ where: { userId: user.id } });
  if (teams.length) {
    await prisma.favoriteTeam.createMany({ data: teams.map((t) => ({ userId: user.id, teamId: t.id })), skipDuplicates: true });
  }
  redirect(back("&saved=1"));
}

// A page (brand) may only be changed by the account it belongs to.
export async function renamePage(formData: FormData) {
  "use server";
  const user = await requireUser();
  const brandId = String(formData.get("brandId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const brand = brandId ? await prisma.brand.findFirst({ where: { id: brandId, userId: user.id } }) : null;
  if (!brand) redirect(back("&page=notfound"));
  if (!name || name.length > 60) redirect(back("&page=name"));

  await prisma.brand.update({ where: { id: brand.id }, data: { name } });
  redirect(back("&page=saved"));
}

// Deletes the account and everything that belongs to it. Pages, subscriptions, selections and
// followed clubs go with the user row (onDelete: Cascade in the schema). The shared Match and Team
// tables are not touched. The bot manager notices the missing bot token within 30 seconds.
export async function deleteAccount(formData: FormData) {
  "use server";
  const account = await requireUser();
  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { id: account.id },
    include: {
      brands: { select: { id: true, backgroundPath: true, logoPath: true } },
      selections: { select: { status: true, backgroundPath: true } },
    },
  });
  if (!user) redirect("/login");
  if (typed !== user.email) redirect(back("&acct=confirm"));
  if (user.selections.some((s) => s.status === "SENDING")) redirect(back("&acct=busy"));

  await deleteAccountFiles(user); // files first: once the rows are gone the paths are lost
  await prisma.user.delete({ where: { id: user.id } }); // sessions go with it (cascade)
  await clearSessionCookie();
  redirect("/login?deleted=1");
}
