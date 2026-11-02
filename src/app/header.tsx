"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "./theme-toggle";
import SubmitButton from "./submit-button";
import { logout } from "@/lib/auth-actions";
import { SITE } from "@/lib/site";

type HeaderProps = {
  user: { email: string; name?: string | null } | null;
};

export default function Header({ user }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isDashboard = pathname === "/dashboard";

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="landing-header" role="banner">
      <div className="landing-header-inner container">
        <Link href="/" className="landing-brand" aria-label={`${SITE.name} home`}>
          <span className="landing-brand-dot" aria-hidden="true" />
          <span className="landing-brand-text">{SITE.name}</span>
        </Link>

        {/* Section links exist only on the landing page; other pages show just the brand and the account buttons. */}
        {isHome && (
          <nav className="landing-nav" aria-label="Landing page sections">
            {SITE.nav.map((n) => (
              <a key={n.href} href={n.href}>
                {n.label}
              </a>
            ))}
          </nav>
        )}

        <div className="landing-header-actions">
          {user ? (
            <>
              <form action={logout} className="header-logout-form">
                <SubmitButton
                  label="Log out"
                  pendingLabel="Logging out..."
                  variant="ghost"
                  className="btn sm header-logout-btn"
                />
              </form>
              <Link
                href="/dashboard"
                className={`btn sm ${isDashboard ? "header-active-link" : ""}`}
                aria-current={isDashboard ? "page" : undefined}
              >
                {isDashboard ? "Dashboard" : "Go to Dashboard"}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="landing-login-link">
                Log in
              </Link>
              <Link href="/signup" className="btn sm">
                Create account
              </Link>
            </>
          )}

          <ThemeToggle />

          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <>
          <div
            className="mobile-nav-backdrop"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <nav id="mobile-nav-menu" className="mobile-nav-menu" aria-label="Mobile navigation">
            {isHome && (
              <>
                {SITE.nav.map((n) => (
                  <a key={n.href} href={n.href} onClick={() => setMobileOpen(false)}>
                    {n.label}
                  </a>
                ))}
                <div className="mobile-nav-divider" />
              </>
            )}

            <div className="mobile-nav-actions">
              {user ? (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="btn sm mobile-nav-btn"
                    aria-current={isDashboard ? "page" : undefined}
                  >
                    {isDashboard ? "Dashboard" : "Go to Dashboard"}
                  </Link>
                  <form action={logout} className="mobile-logout-form">
                    <SubmitButton
                      label="Log out"
                      pendingLabel="Logging out..."
                      variant="ghost"
                      className="btn sm mobile-nav-btn"
                    />
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMobileOpen(false)} className="mobile-nav-link">
                    Log in
                  </Link>
                  <Link href="/signup" onClick={() => setMobileOpen(false)} className="btn sm mobile-nav-btn">
                    Create account
                  </Link>
                </>
              )}
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
