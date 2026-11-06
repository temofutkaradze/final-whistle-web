import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SITE } from "@/lib/site";

export default async function Dashboard() {
  await requireUser();

  return (
    <div className="container dash-page workspace-page">
      <h1>Your workspace</h1>
      <p className="lead">Choose a generator. Manage your designs here and create your posts in Telegram.</p>
      <div className="generator-grid">
        <Link href="/dashboard/match" className="card generator-card">
          <img className="generator-artwork" src={SITE.examples[1].src} alt="" width="96" height="120" />
          <div className="generator-copy">
            <h2 className="card-title">Match Generator</h2>
            <p className="muted">Manage match templates, results, fixtures, leagues and your Match Telegram bot.</p>
            <span className="generator-action">Open Match Generator <span aria-hidden="true">&#8594;</span></span>
          </div>
        </Link>
        <Link href="/news" className="card generator-card">
          <img className="generator-artwork" src="/news-previews/single.jpg" alt="" width="96" height="120" />
          <div className="generator-copy">
            <h2 className="card-title">News Generator</h2>
            <p className="muted">Choose from four news layouts, customize your templates and manage your News Telegram bot.</p>
            <span className="generator-action">Open News Generator <span aria-hidden="true">&#8594;</span></span>
          </div>
        </Link>
      </div>
    </div>
  );
}
