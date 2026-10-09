import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { LEAGUES } from "@/lib/leagues";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAccount(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const brandName = String(formData.get("brandName") ?? "").trim();
  const backgroundUrl = String(formData.get("backgroundUrl") ?? "").trim();
  const leagueIds = formData
    .getAll("leagues")
    .map((v) => Number(v))
    .filter((id) => LEAGUES.some((l) => l.id === id));

  if (!EMAIL_RE.test(email)) redirect("/signup?error=email");
  if (!brandName) redirect("/signup?error=brand");
  if (leagueIds.length === 0) redirect("/signup?error=leagues");
  if (backgroundUrl && !/^https?:\/\//i.test(backgroundUrl)) redirect("/signup?error=background");

  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name: name || null },
  });

  await prisma.brand.create({
    data: { userId: user.id, name: brandName, backgroundUrl: backgroundUrl || null },
  });
  await prisma.subscription.create({
    data: { userId: user.id, leagueIds },
  });

  redirect(`/dashboard?email=${encodeURIComponent(email)}`);
}

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  brand: "Please enter the name of your page.",
  leagues: "Choose at least one league.",
  background: "The background must be a link starting with http:// or https://.",
};

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <h1>Create a demo account</h1>
      <p className="lead">Tell us which page the posts are for and which leagues you follow.</p>
      {error && ERRORS[error] && <p className="error">{ERRORS[error]}</p>}
      <form action={createAccount}>
        <label htmlFor="email">
          Email
          <input id="email" name="email" type="email" required autoComplete="email" />
        </label>
        <label htmlFor="name">
          Your name <small>(optional)</small>
          <input id="name" name="name" type="text" autoComplete="name" />
        </label>
        <label htmlFor="brandName">
          Page name shown on the image
          <input id="brandName" name="brandName" type="text" required placeholder="e.g. day on football" />
        </label>
        <label htmlFor="backgroundUrl">
          Background image link <small>(optional, https://…)</small>
          <input id="backgroundUrl" name="backgroundUrl" type="url" placeholder="https://" />
        </label>
        <fieldset>
          <legend>Leagues</legend>
          {LEAGUES.map((l) => (
            <label key={l.id} className="check" htmlFor={`league-${l.id}`}>
              <input id={`league-${l.id}`} type="checkbox" name="leagues" value={l.id} />
              {l.name}
            </label>
          ))}
        </fieldset>
        <button type="submit">Create account</button>
      </form>
    </>
  );
}
