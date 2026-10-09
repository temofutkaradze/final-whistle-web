import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { botLink, sendDocument, sendMessage } from "@/lib/telegram";
import { renderSamplePost } from "@/lib/render";

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
      await sendMessage(user.telegramChatId, "Test message from Final Whistle. Your chat is connected.");
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
      await sendDocument(user.telegramChatId, jpgPath, `Sample post for ${brand.name}`);
      result = "ok";
    } catch (e) {
      console.error("sendSample failed:", e);
      result = "fail";
    }
  }
  redirect(back(email, `&sample=${result}`));
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; test?: string; sample?: string }>;
}) {
  const { email, test, sample } = await searchParams;

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

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lead">
        {user.name ? `${user.name} · ` : ""}
        {user.email}
      </p>

      <h2>Telegram</h2>
      {user.telegramChatId ? (
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
