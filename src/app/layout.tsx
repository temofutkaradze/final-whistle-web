import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";

export const metadata: Metadata = {
  title: "Final Whistle",
  description: "Football result posts for Instagram, generated automatically.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">
            Final Whistle
          </a>
          <nav>
            {user ? (
              <>
                <a href="/dashboard">Dashboard</a>
                <form action={logout} style={{ display: "inline", margin: 0 }}>
                  <button type="submit">Log out</button>
                </form>
              </>
            ) : (
              <>
                <a href="/login">Log in</a>
                <a href="/signup">Create account</a>
              </>
            )}
          </nav>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
