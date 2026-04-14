import { redirect } from "next/navigation";

import { KakaoSignInButton } from "@/components/kakao-sign-in-button";
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

  return (
    <main className="mx-auto grid min-h-screen max-w-[1200px] place-items-center px-4 py-6 md:px-6 md:py-10">
      <section className="w-full max-w-[460px] rounded-[28px] border border-black/6 bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.08)] sm:p-8">
        <div className="space-y-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FEE500] text-base font-semibold text-[#191919]">
            K
          </div>
          <h1 className="text-[1.9rem] font-semibold leading-tight text-[#111827] sm:text-[2.2rem]">
            Sign in with Kakao
          </h1>
          <p className="text-sm leading-7 text-slate-600">
            Use your Kakao account to access the shared article dashboard.
          </p>
        </div>

        <div className="mt-8 rounded-[24px] bg-[#FFF9CC] p-4">
          <KakaoSignInButton next={next} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 text-[12px] text-slate-500">
          <span>Kakao only</span>
          <span>Secure Supabase Auth</span>
        </div>

        <p className="mt-6 text-xs leading-6 text-slate-500">
          After sign-in, you will return to the page you originally requested.
        </p>
      </section>
    </main>
  );
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
