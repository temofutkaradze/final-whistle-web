import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { botLink, sendDocument, sendMessage } from "@/lib/telegram";
import { renderSamplePost } from "@/lib/render";
import { LEAGUES } from "@/lib/leagues";
import { encryptSecret, userBotToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const TZ = process.env.DISPLAY_TZ || "Asia/Tbilisi";

function formatKickoff(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

const STATUS_LABEL: Record<string, string> = {
  SELECTED: "Waiting for the match to finish",
  SENDING: "Creating your post",
  COMPLETED: "Sent to Telegram",
  FAILED: "Could not be created",
};

const BOT_MESSAGES: Record<string, string> = {
  ok: "Bot connected. Open it in Telegram and press Start.",
  removed: "Bot disconnected.",
  format: "That does not look like a bot token. Copy the whole token from @BotFather.",
  invalid: "Telegram does not accept this token. Check it and try again.",
  net: "Could not reach Telegram. Try again in a moment.",
  taken: "This bot is already connected to another account.",
  secret: "The server setting APP_SECRET is missing, so the token cannot be stored safely.",
};

function back(email: string, extra = ""): string {
  return `/dashboard?email=${encodeURIComponent(email)}${extra}`;
}

async function createLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.linkCode) {
    await prisma.user.update({
      where: { id: user.id },
      data: { linkCode: randomUUID().replace(/-/g, "") },
    });
  }
  redirect(back(email));
}

async function sendTest(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  let result = "nochat";
  if (user?.telegramChatId) {
    try {
      await sendMessage(user.telegramChatId, "Test message from Final Whistle. Your chat is connected.", userBotToken(user));
      result = "ok";
    } catch (e) {
      console.error("sendTest failed:", e);
      result = "fail";
    }
  }
  redirect(back(email, `&test=${result}`));
}

// Renders a sample post for the user's newest page (sample match, their page name and
// background) with the local render server and sends it to their Telegram chat.
async function sendSample(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { brands: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  let result = "nochat";
  const brand = user?.brands[0];
  if (user?.telegramChatId && brand) {
    try {
      const jpgPath = await renderSamplePost(brand);
      await sendDocument(user.telegramChatId, jpgPath, `Sample post for ${brand.name}`, userBotToken(user));
      result = "ok";
    } catch (e) {
      console.error("sendSample failed:", e);
      result = "fail";
    }
  }
  redirect(back(email, `&sample=${result}`));
}

// Saves the customer's OWN Telegram bot (created with @BotFather). The token is stored encrypted.
async function connectBot(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) redirect(back(email, "&bot=format"));

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) redirect(back(email));

  let me: { ok?: boolean; result?: { id: number; username?: string } } | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
    me = await res.json();
  } catch {
    me = null;
  }
  if (!me) redirect(back(email, "&bot=net"));
  if (!me.ok || !me.result) redirect(back(email, "&bot=invalid"));

  let encrypted = "";
  try {
    encrypted = encryptSecret(token);
  } catch {
    redirect(back(email, "&bot=secret"));
  }

  const botId = String(me.result.id);
  const taken = await prisma.user.findFirst({ where: { botId, NOT: { id: user.id } } });
  if (taken) redirect(back(email, "&bot=taken"));

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
  redirect(back(email, "&bot=ok"));
}

async function disconnectBot(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { botToken: null, botId: null, botUsername: null, telegramChatId: null, telegramLinkedAt: null },
    });
  }
  redirect(back(email, "&bot=removed"));
}

// Saves which leagues and clubs the customer follows (used by /matches in Telegram).
async function saveFilters(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) redirect(back(email));

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
  redirect(back(email, "&saved=1"));
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; test?: string; sample?: string; saved?: string; bot?: string }>;
}) {
  const { email, test, sample, saved, bot } = await searchParams;

  if (!email) {
    return (
      <>
        <h1>Dashboard</h1>
        <form action="/dashboard" method="get">
          <label htmlFor="email">
            Your email
            <input id="email" name="email" type="email" required />
          </label>
          <button type="submit">Open dashboard</button>
        </form>
        <p className="notice">Demo build: no passwords yet, the email is the only identifier.</p>
      </>
    );
  }

  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: {
      brands: { orderBy: { createdAt: "desc" } },
      selections: { orderBy: { createdAt: "desc" }, take: 30, include: { match: true } },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      favoriteTeams: true,
    },
  });

  if (!user) {
    return (
      <>
        <h1>Dashboard</h1>
        <p>
          No account found for <strong>{email}</strong>. <a href="/signup">Create one</a>.
        </p>
      </>
    );
  }

  const link = user.linkCode ? botLink(user.linkCode) : null;
  const chosenLeagues = new Set(user.subscriptions[0]?.leagueIds ?? []);
  const chosenTeams = new Set(user.favoriteTeams.map((f) => f.teamId));
  const allTeams = await prisma.team.findMany({ orderBy: { name: "asc" } });

  const connectedCard = (
    <div className="card">
      <strong>Connected</strong>
      <small>Posts will be delivered to your Telegram chat.</small>
      <form action={sendTest} style={{ marginTop: 12 }}>
        <input type="hidden" name="email" value={user.email} />
        <button type="submit">Send a test message</button>
      </form>
      {test === "ok" && <p>Test message sent. Check Telegram.</p>}
      {test === "fail" && <p className="error">Sending failed. See the terminal where `npm run dev` runs.</p>}

      <form action={sendSample} style={{ marginTop: 12 }}>
        <input type="hidden" name="email" value={user.email} />
        <button type="submit">Send a sample post</button>
      </form>
      <small>Takes a few seconds. The render server must be running (port 4500).</small>
      {sample === "ok" && <p>Sample post sent. Check Telegram.</p>}
      {sample === "fail" && (
        <p className="error">
          Could not create or send the post. Is the render server running? Details are in the terminal where
          `npm run dev` runs.
        </p>
      )}
    </div>
  );

  // Shared demo bot: link with a code (used until the customer connects their own bot).
  const sharedFlow = user.telegramChatId ? (
    connectedCard
  ) : !user.linkCode ? (
    <div className="card">
      <strong>Not connected</strong>
      <form action={createLink} style={{ marginTop: 12 }}>
        <input type="hidden" name="email" value={user.email} />
        <button type="submit">Create Telegram connect link</button>
      </form>
    </div>
  ) : link ? (
    <div className="card">
      <strong>Almost there</strong>
      <small>Open the link, press Start in Telegram, then reload this page.</small>
      <p>
        <a className="btn" href={link} target="_blank" rel="noreferrer">
          Open Telegram
        </a>
      </p>
    </div>
  ) : (
    <p className="error">TELEGRAM_BOT_USERNAME is not set in .env.</p>
  );

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lead">
        {user.name ? `${user.name} · ` : ""}
        {user.email}
      </p>

      <h2>Telegram</h2>
      {bot && BOT_MESSAGES[bot] && <p className={bot === "ok" || bot === "removed" ? "" : "error"}>{BOT_MESSAGES[bot]}</p>}
      {user.botToken ? (
        <>
          {user.telegramChatId ? (
            connectedCard
          ) : (
            <div className="card">
              <strong>Almost there</strong>
              <small>Open your bot @{user.botUsername}, press Start, then reload this page.</small>
              <p>
                <a className="btn" href={`https://t.me/${user.botUsername}`} target="_blank" rel="noreferrer">
                  Open @{user.botUsername}
                </a>
              </p>
            </div>
          )}
          <form action={disconnectBot}>
            <input type="hidden" name="email" value={user.email} />
            <button type="submit">Disconnect this bot</button>
          </form>
        </>
      ) : (
        <>
          {sharedFlow}
          <div className="card">
            <strong>Use your own bot (recommended)</strong>
            <small>
              1. In Telegram open @BotFather, send /newbot and choose a name and a username.
              <br />
              2. Copy the token it gives you (it looks like 123456789:ABC...).
              <br />
              3. Paste it below. Never share this token with anyone.
            </small>
            <form action={connectBot} style={{ marginTop: 12 }}>
              <input type="hidden" name="email" value={user.email} />
              <input type="text" name="token" placeholder="123456789:ABC..." autoComplete="off" required />
              <button type="submit">Connect my bot</button>
            </form>
          </div>
        </>
      )}

      <h2>Pages</h2>
      {user.brands.map((b) => (
        <div className="card" key={b.id}>
          <strong>{b.name}</strong>
          <small>
            Backgrounds are sent per match in Telegram: select a match, then send the photo you want behind it.
          </small>
        </div>
      ))}

      <h2>Leagues and clubs</h2>
      <small>/matches in Telegram shows matches of the leagues you tick, plus any match of the clubs you tick.</small>
      <form action={saveFilters}>
        <input type="hidden" name="email" value={user.email} />
        {LEAGUES.map((l) => {
          const clubs = allTeams.filter((t) => t.leagueId === l.id);
          return (
            <details key={l.id} className="card">
              <summary>
                <label className="check" style={{ display: "inline-flex" }}>
                  <input type="checkbox" name="leagues" value={l.id} defaultChecked={chosenLeagues.has(l.id)} />
                  <strong style={{ display: "inline" }}>{l.name}</strong>
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
        <button type="submit">Save</button>
        {saved === "1" && <p>Saved. Send /matches in Telegram to see the new list.</p>}
      </form>

      <h2>My matches</h2>
      <small>Pick matches in Telegram with /matches. This list updates when you reload the page.</small>
      {user.selections.length === 0 && <p>No matches selected yet.</p>}
      {user.selections.map((sel) => {
        const m = sel.match;
        const finished = m.homeScore !== null && m.awayScore !== null && ["FT", "AET", "PEN"].includes(m.statusShort);
        return (
          <div className="card" key={sel.id}>
            <strong>
              {m.homeTeam} {finished ? `${m.homeScore} - ${m.awayScore}` : "-"} {m.awayTeam}
            </strong>
            <small>
              {m.leagueName} · {formatKickoff(m.kickoff)}
            </small>
            <div className="pills">
              <span className="pill">{STATUS_LABEL[sel.status] ?? sel.status}</span>
              {sel.backgroundPath && <span className="pill">Custom background</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
