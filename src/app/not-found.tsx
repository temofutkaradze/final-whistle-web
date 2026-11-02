import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function NotFound() {
  const user = await getCurrentUser();

  return (
    <div className="container not-found-page">
      <div className="not-found-card">
        <p className="eyebrow not-found-eyebrow">404 · Page Not Found</p>
        <h1 className="not-found-title">The whistle blew early.</h1>
        <p className="lead not-found-sub">
          The page you are looking for does not exist, has moved, or the match has finished.
        </p>
        <div className="not-found-actions">
          <Link className="btn" href="/">
            Back to home
          </Link>
          {user ? (
            <Link className="btn ghost" href="/dashboard">
              Go to Dashboard
            </Link>
          ) : (
            <Link className="btn ghost" href="/login">
              Log in to dashboard
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
