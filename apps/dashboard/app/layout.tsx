import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Article Review Dashboard",
  description: "Review shared article rows with Supabase-backed sign-in and review state.",
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
