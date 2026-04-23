"use client";

import { startTransition, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  children,
}: {
  action?: string;
  method?: "get" | "post";
  className?: string;
  checkboxGroupName?: string;
  maxCheckedValues?: number;
  maxCheckedMessage?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

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

  return (
    <form ref={formRef} action={action} method={method} className={className} onSubmit={handleSubmit}>
      <fieldset className="contents" disabled={isPending}>
        {children}
      </fieldset>
    </form>
  );
}
