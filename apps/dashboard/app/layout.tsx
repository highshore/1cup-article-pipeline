import type { Metadata } from "next";

import StyledComponentsRegistry from "@/lib/styled-components-registry";

import "./globals.css";

export const metadata: Metadata = {
  title: "Article Review Dashboard",
  description: "Review shared article rows with Supabase-backed sign-in and review state.",
  icons: {
    icon: "/coffee.png",
    shortcut: "/coffee.png",
    apple: "/coffee.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="app-grid font-[family:var(--font-sans)] antialiased">
        <StyledComponentsRegistry>{children}</StyledComponentsRegistry>
      </body>
    </html>
  );
}
