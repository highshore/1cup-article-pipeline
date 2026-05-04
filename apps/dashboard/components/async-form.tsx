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
  confirmMessage,
  autoSubmit = false,
  autoSubmitDelayMs = 350,
  children,
}: {
  action?: string;
  method?: "get" | "post";
  className?: string;
  checkboxGroupName?: string;
  maxCheckedValues?: number;
  maxCheckedMessage?: string;
  confirmMessage?: string;
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
    const targetAction = action ?? form.action ?? pathname;
    const currentScrollY = window.scrollY;

    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }

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

      const response = await fetch(targetAction, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-dashboard-async": "1",
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Unable to process the request. (${response.status})`);
      }

      startTransition(() => {
        router.refresh();
      });
      restoreScrollPosition(currentScrollY);
      formRef.current?.reset();
    } catch (error) {
      console.error("dashboard form submission failed", error);
      window.alert(error instanceof Error ? error.message : "Unable to process the request.");
    } finally {
      setIsPending(false);
    }
  };

  const handleChange = (event: FormEvent<HTMLFormElement>) => {
    if (!autoSubmit || method !== "get") {
      return;
    }

    if (autoSubmitTimeoutRef.current) {
      window.clearTimeout(autoSubmitTimeoutRef.current);
    }

    const target = event.target;
    const shouldDebounce =
      target instanceof HTMLInputElement &&
      (target.type === "search" || target.type === "text");
    const delay = shouldDebounce ? autoSubmitDelayMs : 0;

    autoSubmitTimeoutRef.current = window.setTimeout(() => {
      formRef.current?.requestSubmit();
    }, delay);
  };

  return (
    <form ref={formRef} action={action} method={method} className={className} onChange={handleChange} onSubmit={handleSubmit}>
      <fieldset className="contents" disabled={isPending}>
        {children}
      </fieldset>
    </form>
  );
}
