"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

export function DashboardAutoRefresh({
  enabled,
  intervalMs = 5000,
}: {
  enabled: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    };

    const intervalId = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [enabled, intervalMs, router]);

  return null;
}
