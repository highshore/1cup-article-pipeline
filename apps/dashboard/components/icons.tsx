type IconProps = {
  className?: string;
};

function BaseIcon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function HomeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.25 9.75V21h13.5V9.75" />
      <path d="M9.75 21v-6h4.5v6" />
    </BaseIcon>
  );
}

export function BoltIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M13.5 2.25 5.25 13.5h5.25l-1.5 8.25L18.75 10.5H13.5l0-8.25Z" />
    </BaseIcon>
  );
}

export function NewspaperIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M6 8.25h12" />
      <path d="M6 12h12" />
      <path d="M6 15.75h7.5" />
      <path d="M4.5 5.25h15a1.5 1.5 0 0 1 1.5 1.5V18a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 18V5.25Z" />
      <path d="M4.5 18a2.25 2.25 0 0 0 2.25 2.25" />
    </BaseIcon>
  );
}

export function CommandLineIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m6.75 8.25 3 3-3 3" />
      <path d="M11.25 14.25h6" />
      <rect height="15" rx="2.25" width="18" x="3" y="4.5" />
    </BaseIcon>
  );
}

export function ArrowPathIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M16.023 9.348h4.992V4.356" />
      <path d="M2.985 19.644v-4.992h4.992" />
      <path d="M4.5 9.75a7.5 7.5 0 0 1 12.495-5.394L21.015 8.4" />
      <path d="M19.5 14.25a7.5 7.5 0 0 1-12.495 5.394L2.985 15.6" />
    </BaseIcon>
  );
}
