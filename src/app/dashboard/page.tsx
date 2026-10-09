import { prisma } from "@/lib/db";
import { leagueName } from "@/lib/leagues";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

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

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      brands: { orderBy: { createdAt: "desc" } },
      subscriptions: { orderBy: { createdAt: "desc" } },
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

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lead">{user.name ? `${user.name} · ` : ""}{user.email}</p>

      <h2>Pages</h2>
      {user.brands.map((b) => (
        <div className="card" key={b.id}>
          <strong>{b.name}</strong>
          <small>{b.backgroundUrl ?? "No background yet"}</small>
        </div>
      ))}

      <h2>Subscriptions</h2>
      {user.subscriptions.map((s) => (
        <div className="card" key={s.id}>
          <strong>
            {s.plan} · {s.status}
          </strong>
          <div className="pills">
            {s.leagueIds.map((id) => (
              <span className="pill" key={id}>
                {leagueName(id)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
