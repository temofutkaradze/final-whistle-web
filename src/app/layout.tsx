import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import { SITE } from "@/lib/site";
import ThemeToggle from "./theme-toggle";

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: SITE.name, description: SITE.description, siteName: SITE.name, type: "website" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1311" },
  ],
};

// Runs before the page is painted, so a saved dark choice never flashes white.
const THEME_SCRIPT = `try{var t=localStorage.getItem("fw-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="top">
          <a href="/" className="brand">
            {SITE.name}
          </a>
          <nav>
            {user ? (
              <>
                <a href="/dashboard">Dashboard</a>
                <form action={logout}>
                  <button type="submit" className="ghost sm">
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/login">Log in</a>
                <a href="/signup" className="btn sm">
                  Create account
                </a>
              </>
            )}
            <ThemeToggle />
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
