import { redirect } from "next/navigation";

import { getAccessContext } from "@/lib/access";
import { SignInScreen } from "@/components/sign-in-screen";
import { getOptionalUser } from "@/lib/auth";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getOptionalUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const next = sanitizeNext(getFirst(resolvedSearchParams?.next));

  if (user) {
    const access = await getAccessContext(user);
    redirect(access.isAuthorized ? next : "/unauthorized");
  }

  return <SignInScreen next={next} />;
}

function getFirst(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sanitizeNext(value: string): string {
  if (!(value && value.startsWith("/")) || value.startsWith("//")) {
    return "/";
  }

  return value;
}
