import { matchSampleAdmission } from "@/lib/admission";
import { registerBot, createWithinTemplateQuota } from "@/lib/resource-transactions";
﻿import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendDocument, sendMessage } from "@/lib/telegram";
import { renderSamplePost } from "@/lib/render";
import { BUILTIN_TEMPLATES, MAX_CUSTOM_TEMPLATES, builtinTemplateHtml, customTemplateId, isBuiltinTemplate, previewHtml } from "@/lib/templates";
import { brandInnerHtml } from "@/lib/sample-match";
import { SITE } from "@/lib/site";
import { normalizeConfig } from "@/lib/template-builder";
import { prepareTemplateInput } from "@/lib/template-input";
import { MAX_LOGO_UPLOAD, deleteLogoFile, logoDataUri, saveLogo } from "@/lib/logos";
import { LEAGUES } from "@/lib/leagues";
import { encryptSecret, userBotToken } from "@/lib/crypto";
import { deleteAccountFiles } from "@/lib/backgrounds";
import { clearSessionCookie, requireUser } from "@/lib/auth";
import TemplatePicker from "../template-picker";
import AddTemplate, { type Editing, type SaveState } from "../add-template";
import SubmitButton from "@/app/submit-button";
import {approvedMatchUser,lockMatchAccount} from "../../../../scripts/lib/match-pairing.mjs";
import PairingForm from "./pairing-form";
import BackToDashboard from "@/app/back-to-dashboard";

export const dynamic = "force-dynamic";

const BOT_MESSAGES: Record<string, string> = {
  ok: "Bot connected. Open it in Telegram and press Start.",
  removed: "Bot disconnected.",
  format: "That does not look like a bot token. Copy the whole token from @BotFather.",
  invalid: "Telegram does not accept this token. Check it and try again.",
  net: "Could not reach Telegram. Try again in a moment.",
  taken: "This bot is already connected to another account.",
  secret: "The server setting APP_SECRET is missing, so the token cannot be stored safely.",
};

const PAGE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Page name saved." },
  name: { ok: false, text: "Please enter a page name (up to 60 characters)." },
  notfound: { ok: false, text: "That page was not found." },
};

const LOOK_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved. Every new post uses this look." },
  badlogo: { ok: false, text: "That file is not a usable picture. Use a PNG, JPG or WebP image." },
  biglogo: { ok: false, text: "The logo is larger than 5 MB." },
  nologo: { ok: false, text: "Upload a logo first. Until then your page name is shown." },
  notfound: { ok: false, text: "Your page was not found." },
  tpladded: { ok: true, text: "Template saved and selected for your page." },
  tplupdated: { ok: true, text: "Template updated." },
  tpldeleted: { ok: true, text: "Template deleted." },
};

const ACCOUNT_MESSAGES: Record<string, string> = {
  confirm: "The email you typed does not match this account. Nothing was deleted.",
  busy: "A post is being created for you right now. Please try again in a minute.",
};

// extra looks like "&bot=ok"; the account comes from the login session, never from the URL.
function back(extra = ""): string {
  const query = extra.replace(/^&/, "");
  return query ? `/dashboard/match?${query}` : "/dashboard/match";
}

async function sendTest() {
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
async function sendSample() {
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
async function saveLook(formData: FormData) {
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
async function saveTemplate(_prev: SaveState, formData: FormData): Promise<SaveState> {
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

async function deleteTemplate(id: string, _formData: FormData) {
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
async function connectBot(formData: FormData) {
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

async function disconnectBot() {
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
async function saveFilters(formData: FormData) {
  "use server";
  const user = await requireUser();

  const leagueIds = formData
    .getAll("leagues")
    .map((v) => Number(v))
    .filter((id) => LEAGUES.some((l) => l.id === id));
  const wantedTeams = formData.getAll("teams").map((v) => Number(v)).filter((n) => Number.isInteger(n));
  const teams = wantedTeams.length
    ? await prisma.team.findMany({ where: { id: { in: wantedTeams } }, select: { id: true } })
    : [];

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
async function renamePage(formData: FormData) {
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
async function deleteAccount(formData: FormData) {
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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{
    test?: string;
    sample?: string;
    saved?: string;
    bot?: string;
    page?: string;
    look?: string;
    edit?: string;
    acct?: string;
  }>;
}) {
  const { test, sample, saved, bot, page, look, edit, acct } = await searchParams;

  const account = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: account.id },
    include: {
      brands: { orderBy: { createdAt: "desc" } },
      selections: { select: { id: true }, take: 1 },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      favoriteTeams: true,
    },
  });
  if (!user) redirect("/login");

  const approved = await approvedMatchUser(prisma,user.id);
  const chosenLeagues = new Set(user.subscriptions[0]?.leagueIds ?? []);
  const chosenTeams = new Set(user.favoriteTeams.map((f) => f.teamId));
  const allTeams = await prisma.team.findMany({ orderBy: { name: "asc" } });

  const firstSteps = [
    { done: Boolean(approved), title: "Connect your bot", text: "Request a private Telegram pairing code and confirm it here." },
    { done: chosenLeagues.size > 0, title: "Choose your leagues", text: "Used to build your match list." },
    { done: user.selections.length > 0, title: "Select a match", text: "Send /matches to your bot and tap a match. The post arrives when it ends." },
  ];

  const connectedBlock = (
    <>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="pill ok">Connected</span>
        <span className="muted">@{user.botUsername}</span>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Posts are delivered directly to your Telegram chat.
      </p>
      <div className="row" style={{ marginTop: 16 }}>
        <form className="plain" action={sendSample}>
          <SubmitButton label="Send a sample post" pendingLabel="Sending sample..." variant="default" />
        </form>
        <form className="plain" action={sendTest}>
          <SubmitButton label="Send a test message" pendingLabel="Sending..." variant="ghost" />
        </form>
      </div>
      <small style={{ marginTop: 10, display: "block" }}>Takes a few seconds. The render server must be running (<code>npm run render</code>).</small>
      {test === "ok" && (
        <p className="notice ok" role="status" style={{ marginTop: 12 }}>
          Test message sent. Check Telegram.
        </p>
      )}
      {test === "fail" && (
        <p className="notice error" role="alert" style={{ marginTop: 12 }}>
          Sending failed. See the terminal where <code>npm run dev</code> runs.
        </p>
      )}
      {sample === "ok" && (
        <p className="notice ok" role="status" style={{ marginTop: 12 }}>
          Sample post sent. Check Telegram.
        </p>
      )}
      {sample === "fail" && (
        <p className="notice error" role="alert" style={{ marginTop: 12 }}>
          Could not create or send the post. Is the render server running? Details are in the terminal where <code>npm run dev</code> runs.
        </p>
      )}
    </>
  );

  const waitingBlock = (
    <>
      <div className="tg-waiting-banner">
        <span className="tg-pulse-dot" aria-hidden="true" />
        <div>
          <strong style={{ fontSize: 14 }}>Waiting for approved Telegram pairing</strong>
          <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
            Open your bot <strong>@{user.botUsername}</strong> in Telegram and press <strong>Start</strong>. Copy the pairing code and explicitly confirm the Telegram identity below. Existing legacy chat links require reconfirmation.
          </p>
        </div>
      </div>
      <PairingForm />
      <p style={{ marginTop: 16 }}>
        <a className="btn" href={`https://t.me/${user.botUsername}`} target="_blank" rel="noreferrer">
          Open @{user.botUsername}
        </a>
      </p>
    </>
  );

  const connectForm = (
    <>
      <ol className="tg-steps">
        <li>
          <span className="tg-step-num">1</span>
          <span>In Telegram open <strong>@BotFather</strong>, send <code>/newbot</code>, and choose a name and username.</span>
        </li>
        <li>
          <span className="tg-step-num">2</span>
          <span>Copy the HTTP API token BotFather gives you (looks like <code>123456789:ABC...</code>).</span>
        </li>
        <li>
          <span className="tg-step-num">3</span>
          <span>Paste the token below. Never share this token with anyone.</span>
        </li>
        <li>
          <span className="tg-step-num">4</span>
          <span>Open your new bot in Telegram and press <strong>Start</strong>.</span>
        </li>
      </ol>
      <form className="plain" action={connectBot} style={{ marginTop: 18 }}>
        <label htmlFor="bot-token">
          Bot token
          <input id="bot-token" type="text" name="token" placeholder="123456789:ABC..." autoComplete="off" required aria-label="Bot token from BotFather" />
        </label>
        <SubmitButton label="Connect my bot" pendingLabel="Connecting..." variant="default" style={{ marginTop: 4 }} />
      </form>
    </>
  );

  const allDone = firstSteps.every((st) => st.done);
  const brand = user.brands[0];

  // Live previews of every template with this customer's page name or logo (invented sample match).
  const currentLogo = brand?.logoPath ? await logoDataUri(brand.logoPath) : null;
  const brandHtml = brandInnerHtml(brand?.name ?? SITE.name, brand?.brandMode === "logo" ? currentLogo : null);
  const customTemplates = await prisma.template.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, html: true, config: true },
  });
  const tiles = [
    ...(await Promise.all(
      BUILTIN_TEMPLATES.map(async (t) => ({
        key: t.key,
        name: t.name,
        note: t.note,
        custom: false,
        html: previewHtml(await builtinTemplateHtml(t.key), brandHtml),
      })),
    )),
    ...customTemplates.map((t: { id: string; name: string; html: string }) => ({
      key: `custom:${t.id}`,
      name: t.name,
      note: "Your template",
      custom: true,
      html: previewHtml(t.html, brandHtml),
    })),
  ];

  // Edit mode (?edit=<template key>): a built-in template opens as HTML (and is saved as a new template),
  // the customer's own template opens as it was made (options form, or HTML code).
  let editing: Editing | null = null;
  if (edit && isBuiltinTemplate(edit)) {
    const meta = BUILTIN_TEMPLATES.find((t) => t.key === edit);
    editing = { key: edit, name: meta?.name ?? edit, html: await builtinTemplateHtml(edit), config: null, ownId: null };
  } else if (edit) {
    const cid = customTemplateId(edit);
    const own = cid ? customTemplates.find((t: { id: string }) => t.id === cid) : null;
    if (own) editing = { key: edit, name: own.name, html: own.html, config: own.config ? normalizeConfig(own.config) : null, ownId: own.id };
  }

  return (
    <div className="container dash-page">
      <BackToDashboard />
      <h1 style={{ marginTop: 16 }}>Match Generator</h1>
      <p className="lead">
        {user.name ? `${user.name} · ` : ""}
        {user.email}
      </p>

      {!allDone && (
        <section className="card" aria-labelledby="first-post" style={{ marginTop: 24 }}>
          <div className="todo-header">
            <strong id="first-post" className="todo-title">Get your first post</strong>
            <span className="todo-badge">
              {firstSteps.filter((st) => st.done).length} of {firstSteps.length} complete
            </span>
          </div>
          <ol className="todo">
            {firstSteps.map((st) => (
              <li key={st.title} className={st.done ? "completed" : ""}>
                <span className={st.done ? "dot done" : "dot"} aria-hidden="true">
                  {st.done && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7.5l2.5 2.5L11 4" />
                    </svg>
                  )}
                </span>
                <div>
                  <b>
                    {st.title}
                    {st.done ? " (done)" : ""}
                  </b>
                  <span className="t">{st.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="dash">
        <section className="card" aria-labelledby="t-tg">
          <h2 className="card-title" id="t-tg">
            Telegram
          </h2>
          {bot && BOT_MESSAGES[bot] && (
            <p className={bot === "ok" || bot === "removed" ? "notice ok" : "notice error"} role={bot === "ok" || bot === "removed" ? "status" : "alert"} style={{ marginTop: 12 }}>
              {BOT_MESSAGES[bot]}
            </p>
          )}
          {user.botToken ? (
            <>
              {approved ? connectedBlock : waitingBlock}
              <form className="plain" action={disconnectBot} style={{ marginTop: 18 }}>
                <SubmitButton label="Disconnect this bot" pendingLabel="Disconnecting..." variant="ghost" className="sm" />
              </form>
            </>
          ) : (
            connectForm
          )}
        </section>

        <section className="card" aria-labelledby="t-page">
          <h2 className="card-title" id="t-page">
            Page
          </h2>
          <p className="muted">The name printed on every post.</p>
          {page && PAGE_MESSAGES[page] && (
            <p className={PAGE_MESSAGES[page].ok ? "notice ok" : "notice error"} role={PAGE_MESSAGES[page].ok ? "status" : "alert"} style={{ marginTop: 12 }}>
              {PAGE_MESSAGES[page].text}
            </p>
          )}
          {brand && (
            <form className="plain" action={renamePage} style={{ marginTop: 16 }}>
              <input type="hidden" name="brandId" value={brand.id} />
              <label htmlFor={`name-${brand.id}`}>
                Page name
                <input id={`name-${brand.id}`} name="name" type="text" defaultValue={brand.name} maxLength={60} required />
              </label>
              <SubmitButton label="Save name" pendingLabel="Saving..." variant="default" />
            </form>
          )}
        </section>

        <section className="card wide" aria-labelledby="t-tpl">
          <h2 className="card-title" id="t-tpl">
            Template and logo
          </h2>
          <p className="muted">The look of every post. Previews use an invented match and update after you save.</p>
          {look && LOOK_MESSAGES[look] && (
            <p className={LOOK_MESSAGES[look].ok ? "notice ok" : "notice error"} role={LOOK_MESSAGES[look].ok ? "status" : "alert"} style={{ marginTop: 12 }}>
              {LOOK_MESSAGES[look].text}
            </p>
          )}
          {brand && (
            <form className="plain" action={saveLook} style={{ marginTop: 8 }}>
              <TemplatePicker tiles={tiles} current={brand.templateRef} canAdd={customTemplates.length < MAX_CUSTOM_TEMPLATES} deleteAction={deleteTemplate} />
              <fieldset className="look-brand">
                <legend>Top corner of the post</legend>
                <label className="check" htmlFor="mode-text">
                  <input id="mode-text" type="radio" name="brandMode" value="text" defaultChecked={brand.brandMode !== "logo"} />
                  My page name ({brand.name})
                </label>
                <label className="check" htmlFor="mode-logo">
                  <input id="mode-logo" type="radio" name="brandMode" value="logo" defaultChecked={brand.brandMode === "logo"} />
                  My logo
                </label>
                <label htmlFor="logo" style={{ marginTop: 10 }}>
                  {currentLogo ? "Replace my logo" : "Upload my logo"} <small>(PNG, JPG or WebP, up to 5 MB. A transparent PNG looks best.)</small>
                  <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
                </label>
                {currentLogo && (
                  <div className="logo-now">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentLogo} alt="Your current logo" />
                    <label className="check" htmlFor="removeLogo">
                      <input id="removeLogo" type="checkbox" name="removeLogo" value="1" />
                      Remove my logo
                    </label>
                  </div>
                )}
              </fieldset>
              <SubmitButton label="Save look" pendingLabel="Saving..." variant="default" />
            </form>
          )}
          <div id="add-template" className="add-panel">
            <AddTemplate key={editing?.key ?? "new"} save={saveTemplate} used={customTemplates.length} max={MAX_CUSTOM_TEMPLATES} brandHtml={brandHtml} editing={editing} />
          </div>
        </section>

        <details className="card wide leagues">
          <summary>
            <span className="card-title">Leagues and clubs</span>
            <span className="summary-badge">
              {chosenLeagues.size} {chosenLeagues.size === 1 ? "league" : "leagues"} Â· {chosenTeams.size}{" "}
              {chosenTeams.size === 1 ? "club" : "clubs"}
            </span>
          </summary>
          <p className="muted" style={{ marginTop: 4 }}>
            /matches in Telegram shows the matches of the leagues you tick, plus any match of the clubs you tick.
          </p>
          <form className="plain" action={saveFilters} style={{ marginTop: 12 }}>
            <div>
              {LEAGUES.map((l) => {
                const clubs = allTeams.filter((t) => t.leagueId === l.id);
                const isLeagueChosen = chosenLeagues.has(l.id);
                const selectedClubsInLeague = clubs.filter((t) => chosenTeams.has(t.id)).length;
                return (
                  <details key={l.id} className="lrow">
                    <summary className="lrow-summary">
                      <label className="check lrow-check" htmlFor={`league-${l.id}`}>
                        <input id={`league-${l.id}`} type="checkbox" name="leagues" value={l.id} defaultChecked={isLeagueChosen} />
                        <span className="lrow-title">{l.name}</span>
                      </label>
                      <span className="lrow-meta">
                        {isLeagueChosen ? (
                          <span className="pill ok sm">All matches followed</span>
                        ) : selectedClubsInLeague > 0 ? (
                          <span className="pill sm">
                            {selectedClubsInLeague} {selectedClubsInLeague === 1 ? "club" : "clubs"} followed
                          </span>
                        ) : (
                          <span className="summary-badge sm">{clubs.length} clubs</span>
                        )}
                      </span>
                    </summary>
                    <div className="lrow-body">
                      {clubs.length === 0 ? (
                        <small className="lrow-empty">No clubs loaded for this league yet.</small>
                      ) : (
                        <div className="clubs">
                          {clubs.map((t) => (
                            <label className="check" key={t.id} htmlFor={`team-${t.id}`}>
                              <input id={`team-${t.id}`} type="checkbox" name="teams" value={t.id} defaultChecked={chosenTeams.has(t.id)} />
                              {t.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            <SubmitButton label="Save leagues & clubs" pendingLabel="Saving..." variant="default" style={{ marginTop: 16 }} />
            {saved === "1" && <p className="notice ok" role="status" style={{ marginTop: 14 }}>Saved. Send /matches in Telegram to see the new list.</p>}
          </form>
        </details>
      </div>

      <details className="danger">
        <summary>Delete account</summary>
        <div style={{ paddingBottom: 24, maxWidth: 560 }}>
          <p className="muted">
            This permanently deletes your pages, your saved bot token, your selected matches and the background photos
            stored for you. The bot itself stays in @BotFather. It cannot be undone.
          </p>
          {acct && ACCOUNT_MESSAGES[acct] && (
            <p className="notice error" role="alert" style={{ marginTop: 12 }}>
              {ACCOUNT_MESSAGES[acct]}
            </p>
          )}
          <form action={deleteAccount} style={{ marginTop: 14 }}>
            <label htmlFor="confirm">
              Type your email ({user.email}) to confirm
              <input id="confirm" name="confirm" type="text" autoComplete="off" required aria-label={`Type ${user.email} to confirm account deletion`} />
            </label>
            <SubmitButton label="Delete my account" pendingLabel="Deleting..." variant="danger" style={{ alignSelf: "flex-start", marginTop: 4 }} />
          </form>
        </div>
      </details>
    </div>
  );
}

