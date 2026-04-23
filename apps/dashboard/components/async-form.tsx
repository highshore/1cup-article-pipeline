"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

function restoreScrollPosition(scrollY: number) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
    });
  });
}

export function AsyncForm({
  action,
  method = "post",
  className,
  checkboxGroupName,
  maxCheckedValues,
  maxCheckedMessage,
  autoSubmit = false,
  autoSubmitDelayMs = 250,
  children,
}: {
  action?: string;
  method?: "get" | "post";
  className?: string;
  checkboxGroupName?: string;
  maxCheckedValues?: number;
  maxCheckedMessage?: string;
  autoSubmit?: boolean;
  autoSubmitDelayMs?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const autoSubmitTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoSubmitTimeoutRef.current) {
        window.clearTimeout(autoSubmitTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentScrollY = window.scrollY;

    if (checkboxGroupName && typeof maxCheckedValues === "number") {
      const checkedCount = formData.getAll(checkboxGroupName).filter((value) => typeof value === "string" && value !== "none").length;
      if (checkedCount > maxCheckedValues) {
        window.alert(maxCheckedMessage ?? `Select up to ${maxCheckedValues} values.`);
        return;
      }
    }

    setIsPending(true);

    try {
      if (method === "get") {
        const query = new URLSearchParams();
        for (const [key, value] of formData.entries()) {
          if (typeof value === "string" && value) {
            query.set(key, value);
          }
        }
        router.replace(query.toString() ? `${pathname}?${query}` : pathname, { scroll: false });
        restoreScrollPosition(currentScrollY);
        return;
      }

      const body = new URLSearchParams();
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          body.append(key, value);
        }
      }

      await fetch(action ?? pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-dashboard-async": "1",
        },
        body,
      });

      startTransition(() => {
        router.refresh();
      });
      restoreScrollPosition(currentScrollY);
      formRef.current?.reset();
    } finally {
      setIsPending(false);
    }
  };

  const handleChange = () => {
    if (!autoSubmit || method !== "get") {
      return;
    }

    if (autoSubmitTimeoutRef.current) {
      window.clearTimeout(autoSubmitTimeoutRef.current);
    }

    autoSubmitTimeoutRef.current = window.setTimeout(() => {
      formRef.current?.requestSubmit();
    }, autoSubmitDelayMs);
  };

  return (
    <form ref={formRef} action={action} method={method} className={className} onChange={handleChange} onSubmit={handleSubmit}>
      <fieldset className="contents" disabled={isPending}>
        {children}
      </fieldset>
    </form>
  );
}
