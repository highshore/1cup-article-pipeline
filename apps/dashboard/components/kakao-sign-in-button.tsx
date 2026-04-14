"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function KakaoSignInButton({ next }: { next: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[#FEE500] px-5 py-3 text-sm font-semibold text-[#191919] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={async () => {
        setIsPending(true);

        try {
          const supabase = createClient();
          const redirectTo = new URL("/auth/callback", window.location.origin);
          redirectTo.searchParams.set("next", next);

          const { error } = await supabase.auth.signInWithOAuth({
            provider: "kakao",
            options: {
              redirectTo: redirectTo.toString(),
            },
          });

          if (error) {
            throw error;
          }
        } catch (error) {
          setIsPending(false);
          window.alert(error instanceof Error ? error.message : "Kakao sign-in failed");
        }
      }}
      type="button"
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#191919] text-[11px] font-semibold text-[#FEE500]">
        K
      </span>
      {isPending ? "Redirecting to Kakao..." : "Continue with Kakao"}
    </button>
  );
}
