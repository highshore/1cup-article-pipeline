"use client";

import Image from "next/image";
import { useState } from "react";
import styled from "styled-components";

import { createClient } from "@/lib/supabase/client";

const Button = styled.button`
  display: inline-flex;
  width: 100%;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 0;
  border-radius: 20px;
  background: #fee500;
  padding: 12px 20px;
  color: #191919;
  font-size: 1rem;
  font-weight: 800;
  transition: filter 140ms ease, opacity 140ms ease;

  &:hover {
    filter: brightness(0.98);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (min-width: 640px) {
    font-size: 1.05rem;
  }
`;

const ButtonLabel = styled.span`
  display: inline-block;
`;

export function KakaoSignInButton({ next }: { next: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <Button
      aria-busy={isPending}
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
      <Image
        src="/signin/kakao_btn-CTybM8yg.png"
        alt=""
        width={22}
        height={22}
        aria-hidden="true"
        className="h-5 w-5 object-contain"
      />
      <ButtonLabel>{isPending ? "Redirecting to Kakao..." : "Continue with Kakao"}</ButtonLabel>
    </Button>
  );
}
