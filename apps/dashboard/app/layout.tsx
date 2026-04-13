import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Article Review Dashboard",
  description: "Review crawled FT and WSJ articles from the crawler SQLite database.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="app-grid font-[family:var(--font-sans)] antialiased">
        {children}
      </body>
    </html>
  );
}
