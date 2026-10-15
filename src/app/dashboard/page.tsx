import Image from "next/image";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sendDocument, sendMessage } from "@/lib/telegram";
import { renderSamplePost } from "@/lib/render";
import { LEAGUES } from "@/lib/leagues";
import { encryptSecret, userBotToken } from "@/lib/crypto";
import { deleteAccountFiles } from "@/lib/backgrounds";
import { clearSessionCookie, requireUser } from "@/lib/auth";
import AutoRefresh from "./auto-refresh";

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

const ACCOUNT_MESSAGES: Record<string, string> = {
  confirm: "The email you typed does not match this account. Nothing was deleted.",
  busy: "A post is being created for you right now. Please try again in a minute.",
};

// extra looks like "&bot=ok"; the account comes from the login session, never from the URL.
function back(extra = ""): string {
  const query = extra.replace(/^&/, "");
  return query ? `/dashboard?${query}` : "/dashboard";
}

async function sendTest() {
  "use server";
  const user = await requireUser();

  let result = "nochat";
  if (user.telegramChatId && user.botToken) {
    try {
      await sendMessage(user.telegramChatId, "Test message from Final Whistle. Your chat is connected.", userBotToken(user) as string);
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
  if (user.telegramChatId && user.botToken && brand) {
    try {
      const jpgPath = await renderSamplePost(brand);
      await sendDocument(user.telegramChatId, jpgPath, `Sample post for ${brand.name}`, userBotToken(user) as string);
      result = "ok";
    } catch (e) {
      console.error("sendSample failed:", e);
      result = "fail";
    }
  }
  redirect(back(`&sample=${result}`));
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
  const taken = await prisma.user.findFirst({ where: { botId, NOT: { id: user.id } } });
  if (taken) redirect(back("&bot=taken"));

  // A new bot means a new chat: the first person who presses Start in it becomes the owner's chat.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      botToken: encrypted,
      botId,
      botUsername: me.result.username ?? null,
      telegramChatId: null,
      telegramLinkedAt: null,
      linkCode: null,
    },
  });
  redirect(back("&bot=ok"));
}

async function disconnectBot() {
  "use server";
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { botToken: null, botId: null, botUsername: null, telegramChatId: null, telegramLinkedAt: null },
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
      brands: { select: { id: true, backgroundPath: true } },
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
    acct?: string;
  }>;
}) {
  const { test, sample, saved, bot, page, acct } = await searchParams;

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

  const chosenLeagues = new Set(user.subscriptions[0]?.leagueIds ?? []);
  const chosenTeams = new Set(user.favoriteTeams.map((f) => f.teamId));
  const allTeams = await prisma.team.findMany({ orderBy: { name: "asc" } });

  const firstSteps = [
    { done: Boolean(user.botToken && user.telegramChatId), title: "Connect your bot", text: "Open your bot in Telegram and press Start." },
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
        Posts are delivered to your Telegram chat.
      </p>
      <div className="row" style={{ marginTop: 16 }}>
        <form className="plain" action={sendSample}>
          <button type="submit">Send a sample post</button>
        </form>
        <form className="plain" action={sendTest}>
          <button type="submit" className="ghost">
            Send a test message
          </button>
        </form>
      </div>
      <small style={{ marginTop: 10 }}>Takes a few seconds. The render server must be running (port 4500).</small>
      {test === "ok" && <p>Test message sent. Check Telegram.</p>}
      {test === "fail" && <p className="error">Sending failed. See the terminal where `npm run dev` runs.</p>}
      {sample === "ok" && <p>Sample post sent. Check Telegram.</p>}
      {sample === "fail" && (
        <p className="error">
          Could not create or send the post. Is the render server running? Details are in the terminal where `npm run dev` runs.
        </p>
      )}
    </>
  );

  const waitingBlock = (
    <>
      <p className="muted" style={{ marginTop: 8 }}>
        Open your bot @{user.botUsername} and press Start. This page updates by itself.
      </p>
      <AutoRefresh />
      <p style={{ marginTop: 16 }}>
        <a className="btn" href={`https://t.me/${user.botUsername}`} target="_blank" rel="noreferrer">
          Open @{user.botUsername}
        </a>
      </p>
    </>
  );

  const connectForm = (
    <>
      <small style={{ marginTop: 8 }}>
        1. In Telegram open @BotFather, send /newbot and choose a name and a username.
        <br />
        2. Copy the token it gives you (it looks like 123456789:ABC...).
        <br />
        3. Paste it below. Never share this token with anyone.
        <br />
        4. Open your bot in Telegram and press Start.
      </small>
      <form className="plain" action={connectBot} style={{ marginTop: 16 }}>
        <input type="text" name="token" placeholder="123456789:ABC..." autoComplete="off" required aria-label="Bot token" />
        <button type="submit">Connect my bot</button>
      </form>
    </>
  );

  const allDone = firstSteps.every((st) => st.done);
  const brand = user.brands[0];

  return (
    <div className="container dash-page">
      <h1>Dashboard</h1>
      <p className="lead">
        {user.name ? `${user.name} · ` : ""}
        {user.email}
      </p>

      {!allDone && (
        <section className="card" aria-labelledby="first-post" style={{ marginTop: 24 }}>
          <strong id="first-post">Get your first post</strong>
          <ol className="todo">
            {firstSteps.map((st) => (
              <li key={st.title}>
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
          {bot && BOT_MESSAGES[bot] && <p className={bot === "ok" || bot === "removed" ? "" : "error"}>{BOT_MESSAGES[bot]}</p>}
          {user.botToken ? (
            <>
              {user.telegramChatId ? connectedBlock : waitingBlock}
              <form className="plain" action={disconnectBot} style={{ marginTop: 18 }}>
                <button type="submit" className="ghost sm">
                  Disconnect this bot
                </button>
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
          {page && PAGE_MESSAGES[page] && <p className={PAGE_MESSAGES[page].ok ? "notice" : "error"}>{PAGE_MESSAGES[page].text}</p>}
          {brand && (
            <form className="plain" action={renamePage} style={{ marginTop: 16 }}>
              <input type="hidden" name="brandId" value={brand.id} />
              <label htmlFor={`name-${brand.id}`}>
                Page name
                <input id={`name-${brand.id}`} name="name" type="text" defaultValue={brand.name} maxLength={60} required />
              </label>
              <button type="submit">Save name</button>
            </form>
          )}
        </section>

        <section className="card wide" aria-labelledby="t-tpl">
          <h2 className="card-title" id="t-tpl">
            Template
          </h2>
          <p className="muted">The look of every post.</p>
          <div className="tpl-grid">
            <div className="tpl on">
              <Image src="/examples/post-bayern-dortmund.jpg" alt="Classic template preview" width={720} height={900} />
              <span className="tpl-name">Classic</span>
              <span className="pill ok">In use</span>
            </div>
            <div className="tpl soon">More templates are on the way.</div>
          </div>
        </section>

        <details className="card wide leagues">
          <summary>
            <span className="card-title">Leagues and clubs</span>
            <span className="muted">
              {chosenLeagues.size} {chosenLeagues.size === 1 ? "league" : "leagues"} · {chosenTeams.size}{" "}
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
                return (
                  <details key={l.id} className="lrow">
                    <summary>
                      <label className="check" style={{ display: "inline-flex", padding: 0 }}>
                        <input type="checkbox" name="leagues" value={l.id} defaultChecked={chosenLeagues.has(l.id)} />
                        {l.name}
                      </label>
                    </summary>
                    {clubs.length === 0 ? (
                      <small>No clubs loaded for this league yet.</small>
                    ) : (
                      <div className="clubs">
                        {clubs.map((t) => (
                          <label className="check" key={t.id}>
                            <input type="checkbox" name="teams" value={t.id} defaultChecked={chosenTeams.has(t.id)} />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
            <button type="submit">Save</button>
            {saved === "1" && <p>Saved. Send /matches in Telegram to see the new list.</p>}
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
          {acct && ACCOUNT_MESSAGES[acct] && <p className="error">{ACCOUNT_MESSAGES[acct]}</p>}
          <form action={deleteAccount} style={{ marginTop: 12 }}>
            <label htmlFor="confirm">
              Type your email ({user.email}) to confirm
              <input id="confirm" name="confirm" type="text" autoComplete="off" required />
            </label>
            <button type="submit" className="ghost danger-btn">
              Delete my account
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
