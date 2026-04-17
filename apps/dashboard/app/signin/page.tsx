import { redirect } from "next/navigation";

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
    redirect(next);
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
