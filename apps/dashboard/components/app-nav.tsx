"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styled from "styled-components";

import { BoltIcon, HomeIcon, ShieldIcon } from "@/components/icons";

const links = [
  { href: "/", label: "Articles", icon: HomeIcon },
  { href: "/runs", label: "Pipeline Runs", icon: BoltIcon },
  { href: "/access", label: "Access", icon: ShieldIcon },
];

const SignOutButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  width: 100%;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  padding: 8px 16px;
  color: #475569;
  font-size: 0.875rem;
  font-weight: 600;
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background-color 140ms ease;

  &:hover {
    border-color: rgb(203 213 225);
    color: #0f172a;
  }

  @media (min-width: 640px) {
    width: auto;
  }
`;

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

      <form action="/auth/signout" method="post">
        <SignOutButton type="submit">Sign out</SignOutButton>
      </form>
    </div>
  );
}
