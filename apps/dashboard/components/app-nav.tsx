"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styled from "styled-components";

import { ArrowRightOnRectangleIcon, BoltIcon, HomeIcon, ShieldIcon } from "@/components/icons";

const links = [
  { href: "/", label: "Articles", icon: HomeIcon },
  { href: "/runs", label: "Research Bot", icon: BoltIcon },
  { href: "/access", label: "Access", icon: ShieldIcon },
];

const NavShell = styled.div`
  --nav-control-height: 46px;
  --nav-item-height: 34px;

  display: flex;
  align-items: center;
  justify-content: flex-start;
`;

const BrandLink = styled(Link)`
  display: inline-flex;
  min-height: var(--nav-item-height);
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #020617;
  padding: 5px 12px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
`;

const NavTrack = styled.nav`
  display: inline-flex;
  min-height: var(--nav-control-height);
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  padding: 6px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(14px);
`;

const SignOutButton = styled.button`
  display: inline-flex;
  min-height: var(--nav-item-height);
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(220, 38, 38, 0.88);
  border-radius: 999px;
  background: #dc2626;
  padding: 6px 12px;
  color: #ffffff;
  font-size: 0.8125rem;
  font-weight: 700;
  box-shadow: 0 8px 20px rgba(220, 38, 38, 0.18);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;

  &:hover {
    border-color: #b91c1c;
    background: #b91c1c;
    box-shadow: 0 10px 24px rgba(220, 38, 38, 0.24);
  }
`;

export function AppNav() {
  const pathname = usePathname();

  return (
    <NavShell>
      <NavTrack>
        <BrandLink href="/">
          <Image
            src="/signin/1cup_logo_new_white.svg"
            alt="1Cupboard"
            width={156}
            height={30}
            priority
            style={{ width: "auto", height: "20px" }}
          />
        </BrandLink>

        {links.map((link) => {
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              className={[
                "inline-flex min-h-[34px] items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
                active ? "bg-ink text-white shadow-sm" : "bg-transparent text-dusk hover:bg-slate-50 hover:text-ink",
              ].join(" ")}
              href={link.href}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}

        <form action="/auth/signout" method="post">
          <SignOutButton type="submit">
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            Sign out
          </SignOutButton>
        </form>
      </NavTrack>
    </NavShell>
  );
}
