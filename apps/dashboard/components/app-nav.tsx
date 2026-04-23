"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styled from "styled-components";

import { BoltIcon, HomeIcon, ShieldIcon } from "@/components/icons";

const links = [
  { href: "/", label: "Articles", icon: HomeIcon },
  { href: "/runs", label: "Research Bot", icon: BoltIcon },
  { href: "/access", label: "Access", icon: ShieldIcon },
];

const NavShell = styled.div`
  --nav-control-height: 54px;
  --nav-item-height: 40px;

  display: grid;
  align-items: center;
  gap: 12px;

  @media (min-width: 1024px) {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }
`;

const BrandWrap = styled.div`
  display: flex;
  justify-content: center;

  @media (min-width: 1024px) {
    justify-content: flex-start;
  }
`;

const BrandLink = styled(Link)`
  display: inline-flex;
  min-height: var(--nav-control-height);
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: #020617;
  padding: 12px 18px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
`;

const CenterWrap = styled.div`
  display: flex;
  justify-content: center;
`;

const NavTrack = styled.nav`
  display: inline-flex;
  min-height: var(--nav-control-height);
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  padding: 6px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(14px);
`;

const RightWrap = styled.div`
  display: flex;
  justify-content: center;

  @media (min-width: 1024px) {
    justify-content: flex-end;
  }
`;

const SignOutButton = styled.button`
  display: inline-flex;
  min-height: var(--nav-control-height);
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  padding: 6px;
  color: #475569;
  font-size: 0.875rem;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(14px);
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;

  span {
    display: inline-flex;
    min-height: var(--nav-item-height);
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 8px 16px;
  }

  &:hover {
    border-color: rgb(203 213 225);
    background: #ffffff;
    color: #0f172a;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  }

  &:hover span {
    background: rgb(248 250 252);
  }
`;

export function AppNav() {
  const pathname = usePathname();

  return (
    <NavShell>
      <BrandWrap>
        <BrandLink href="/">
          <Image
            src="/signin/1cup_logo_new_white.svg"
            alt="1Cupboard"
            width={156}
            height={30}
            priority
            style={{ width: "auto", height: "30px" }}
          />
        </BrandLink>
      </BrandWrap>

      <CenterWrap>
        <NavTrack>
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
        </NavTrack>
      </CenterWrap>

      <RightWrap>
        <form action="/auth/signout" method="post">
          <SignOutButton type="submit">
            <span>Sign out</span>
          </SignOutButton>
        </form>
      </RightWrap>
    </NavShell>
  );
}
