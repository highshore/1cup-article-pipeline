import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/signin");
  }

  if (!isAuthorizedUser(user)) {
    redirect("/unauthorized");
  }

  return { supabase, user };
}

export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export function isAuthorizedUser(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  const blockedEmails = parseList(process.env.DASHBOARD_BLOCKED_EMAILS);
  const blockedUserIds = parseList(process.env.DASHBOARD_BLOCKED_USER_IDS);
  const authorizedEmails = parseList(process.env.DASHBOARD_AUTHORIZED_EMAILS);
  const authorizedUserIds = parseList(process.env.DASHBOARD_AUTHORIZED_USER_IDS);

  const email = normalize(user.email);
  const userId = normalize(user.id);

  if ((email && blockedEmails.has(email)) || (userId && blockedUserIds.has(userId))) {
    return false;
  }

  const hasAllowList = authorizedEmails.size > 0 || authorizedUserIds.size > 0;
  if (!hasAllowList) {
    return true;
  }

  return Boolean((email && authorizedEmails.has(email)) || (userId && authorizedUserIds.has(userId)));
}

function parseList(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((entry) => normalize(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
}

function normalize(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}
