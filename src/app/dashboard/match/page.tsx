import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { BUILTIN_TEMPLATES, MAX_CUSTOM_TEMPLATES, builtinTemplateHtml, customTemplateId, isBuiltinTemplate, previewHtml } from "@/lib/templates";
import { brandInnerHtml } from "@/lib/sample-match";
import { SITE } from "@/lib/site";
import { normalizeConfig } from "@/lib/template-builder";
import { logoDataUri } from "@/lib/logos";
import { LEAGUES, FEATURED_MATCH_TEAMS } from "@/lib/leagues";
import { requireUser } from "@/lib/auth";
import TemplatePicker from "../template-picker";
import AddTemplate, { type Editing } from "../add-template";
import SubmitButton from "@/app/submit-button";
import {approvedMatchUser} from "../../../../scripts/lib/match-pairing.mjs";
import PairingForm from "./pairing-form";
import BackToDashboard from "@/app/back-to-dashboard";

import { BOT_MESSAGES, PAGE_MESSAGES, LOOK_MESSAGES, ACCOUNT_MESSAGES } from "@/features/match/dashboard/messages";
import { sendTest, sendSample, saveLook, saveTemplate, deleteTemplate, connectBot, disconnectBot, saveFilters, renamePage, deleteAccount } from "@/features/match/dashboard/actions";

export const dynamic = "force-dynamic";

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

  let approved: Awaited<ReturnType<typeof approvedMatchUser>>;
  try {
    approved = await approvedMatchUser(prisma,user.id);
  } catch (error) {
    // A deployment/schema mismatch never grants legacy Telegram authorization.
    const failure = error as {code?:string;meta?:{modelName?:string;table?:string}};
    const missingBinding = failure?.code === "P2021" &&
      (failure.meta?.modelName === "MatchTelegramBinding" ||
       /^(?:public\.)?MatchTelegramBinding$/.test(String(failure.meta?.table ?? "").replaceAll('"', '')));
    if (!missingBinding) throw error;
    console.error("[Match] MATCH_PAIRING_SCHEMA_UNAVAILABLE");
    return <div className="container"><BackToDashboard/><h1>Match Generator</h1>
      <p className="notice error" role="alert">Match setup is temporarily unavailable. Your saved settings are preserved. Please contact the administrator.</p>
    </div>;
  }
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
                const clubs = allTeams.filter((t) => t.leagueId === l.id && !FEATURED_MATCH_TEAMS.some(featured=>featured.id===t.id));
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
            <details className="lrow">
              <summary className="lrow-summary"><span className="lrow-title">National teams and Inter Miami</span></summary>
              <div className="lrow-body"><div className="clubs">
                {FEATURED_MATCH_TEAMS.map(team=><label className="check" key={team.id} htmlFor={`team-${team.id}`}>
                  <input id={`team-${team.id}`} type="checkbox" name="teams" value={team.id} defaultChecked={chosenTeams.has(team.id)}/>{team.name}
                </label>)}
              </div></div>
            </details>
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

