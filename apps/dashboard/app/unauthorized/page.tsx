import styled from "styled-components";

const Page = styled.main`
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #ffffff;
`;

const Message = styled.div`
  max-width: 640px;
  color: #111111;
  text-align: center;
  font-size: 1.375rem;
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: -0.02em;

  @media (min-width: 640px) {
    font-size: 1.625rem;
  }
`;

export default function UnauthorizedPage() {
  return (
    <Page>
      <Message>
        Need Authorization from Admin. If you think this is a mistake, contact hello@1cupenglish.com
      </Message>
    </Page>
  );
}
