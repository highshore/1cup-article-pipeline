"use client";

import { useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";

const PHRASES = [
  "Hello, Administrator",
  "운영진을 환영합니다",
  "Bonjour, Administrateur",
  "こんにちは、管理者",
] as const;

const TYPING_SPEED_MS = 85;
const ERASING_SPEED_MS = 42;
const HOLD_MS = 1300;

const caretBlink = keyframes`
  0%, 49% {
    opacity: 1;
  }

  50%, 100% {
    opacity: 0;
  }
`;

const GreetingWrap = styled.div`
  display: flex;
  min-height: 88px;
  align-items: center;
  justify-content: center;
  text-align: center;
`;

const GreetingText = styled.h1`
  color: #111111;
  font-size: 2rem;
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.04em;

  @media (min-width: 640px) {
    font-size: 2.4rem;
  }
`;

const Caret = styled.span`
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 0.25rem;
  transform: translateY(0.08em);
  background: #111111;
  animation: ${caretBlink} 1s step-end infinite;
`;

export function SignInGreeting() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const currentPhrase = useMemo(() => PHRASES[phraseIndex], [phraseIndex]);

  useEffect(() => {
    const atPhraseEnd = characterCount === currentPhrase.length;
    const atPhraseStart = characterCount === 0;

    const timeout = window.setTimeout(
      () => {
        if (!isDeleting && atPhraseEnd) {
          setIsDeleting(true);
          return;
        }

        if (isDeleting && atPhraseStart) {
          setIsDeleting(false);
          setPhraseIndex((current) => (current + 1) % PHRASES.length);
          return;
        }

        setCharacterCount((current) => current + (isDeleting ? -1 : 1));
      },
      !isDeleting && atPhraseEnd ? HOLD_MS : isDeleting ? ERASING_SPEED_MS : TYPING_SPEED_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [characterCount, currentPhrase, isDeleting]);

  return (
    <GreetingWrap>
      <GreetingText>
        {currentPhrase.slice(0, characterCount)}
        <Caret />
      </GreetingText>
    </GreetingWrap>
  );
}
