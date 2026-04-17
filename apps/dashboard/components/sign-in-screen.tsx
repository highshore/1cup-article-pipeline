"use client";

import Image from "next/image";
import Link from "next/link";
import styled from "styled-components";

import { KakaoSignInButton } from "@/components/kakao-sign-in-button";
import { SignInGreeting } from "@/components/sign-in-greeting";

const Page = styled.main`
  min-height: 100vh;
  background: #ffffff;
  color: #141414;
`;

const SplitLayout = styled.div`
  display: grid;
  min-height: 100vh;
  grid-template-columns: 3fr 2fr;

  @media (max-width: 1023px) {
    grid-template-columns: 1fr;
  }
`;

const MediaPane = styled.section`
  position: relative;
  min-height: 44vh;
  overflow: hidden;
  background: #000000;
`;

const BackgroundVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 40% center;
`;

const VideoOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
`;

const BrandBar = styled.div`
  position: relative;
  z-index: 1;
  padding: 24px;

  @media (min-width: 640px) {
    padding: 32px;
  }

  @media (min-width: 768px) {
    padding: 40px;
  }
`;

const BrandLink = styled(Link)`
  display: inline-flex;
  align-items: center;
`;

const FormPane = styled.section`
  display: flex;
  min-height: 56vh;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  padding: 48px 24px;
  text-align: center;

  @media (min-width: 640px) {
    padding: 48px 40px;
  }

  @media (min-width: 768px) {
    padding: 48px 56px;
  }

  @media (min-width: 1024px) {
    padding: 48px 64px;
  }

  @media (min-width: 1280px) {
    padding: 48px 80px;
  }
`;

const FormContent = styled.div`
  display: flex;
  width: 100%;
  max-width: 420px;
  flex-direction: column;
  align-items: center;
`;

const ButtonRow = styled.div`
  width: 100%;
  margin-top: 32px;
`;

export function SignInScreen({ next }: { next: string }) {
  return (
    <Page>
      <SplitLayout>
        <MediaPane>
          <BackgroundVideo autoPlay loop muted playsInline preload="auto">
            <source src="/signin/bg_video.mp4" type="video/mp4" />
          </BackgroundVideo>
          <VideoOverlay />
          <BrandBar>
            <BrandLink href="/signin">
              <Image
                src="/signin/1cup_logo_new_white.svg"
                alt="Partner dashboard logo"
                width={176}
                height={34}
                priority
                style={{ width: "auto", height: "36px" }}
              />
            </BrandLink>
          </BrandBar>
        </MediaPane>

        <FormPane>
          <FormContent>
            <SignInGreeting />
            <ButtonRow>
              <KakaoSignInButton next={next} />
            </ButtonRow>
          </FormContent>
        </FormPane>
      </SplitLayout>
    </Page>
  );
}
