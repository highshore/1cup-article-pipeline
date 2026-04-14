"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BoltIcon, HomeIcon } from "@/components/icons";

const links = [
  { href: "/", label: "Articles", icon: HomeIcon },
  { href: "/runs", label: "Pipeline Runs", icon: BoltIcon },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex w-full flex-wrap items-center gap-1 rounded-full border border-slate-200/70 bg-white/80 p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur sm:w-auto">
        {links.map((link) => {
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              className={[
                "inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                active ? "bg-ink text-white shadow-sm" : "bg-transparent text-dusk hover:bg-slate-50 hover:text-ink",
              ].join(" ")}
              href={link.href}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <Link
        className="inline-flex min-h-10 w-full items-center justify-center rounded-full border border-slate-200/80 bg-white/84 px-4 py-2 text-sm font-semibold text-dusk transition hover:border-slate-300 hover:text-ink sm:w-auto"
        href="/auth/signout"
      >
        Sign out
      </Link>
    </div>
  );
}
