import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Final Whistle",
  description: "Football result posts for Instagram, generated automatically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">
            Final Whistle
          </a>
          <nav>
            <a href="/signup">Create account</a>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
