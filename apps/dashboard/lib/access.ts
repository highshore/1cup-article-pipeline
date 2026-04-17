import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type AccessRole = "supreme_leader" | "authorized" | "pending" | "blocked";

export type AccessRecord = {
  id: number;
  user_id: string | null;
  email: string | null;
  role: AccessRole;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type AccessContext = {
  hasAccessTable: boolean;
  hasSupremeLeader: boolean;
  isAuthorized: boolean;
  isSupremeLeader: boolean;
  role: AccessRole | null;
  record: AccessRecord | null;
};

export async function getAccessContext(user: User): Promise<AccessContext> {
  const supabase = await createClient();
  return getAccessContextWithClient(supabase, user);
}

export async function getAccessContextWithClient(
  supabase: SupabaseClient,
  user: User,
): Promise<AccessContext> {
  const existing = await findAccessRecord(supabase, user);
  if (existing.kind === "missing_table") {
    return {
      hasAccessTable: false,
      hasSupremeLeader: false,
      isAuthorized: true,
      isSupremeLeader: false,
      role: null,
      record: null,
    };
  }

  if (existing.record) {
    return toAccessContext(true, true, existing.record);
  }

  const hasSupremeLeader = await checkHasSupremeLeader(supabase);
  if (hasSupremeLeader === "missing_table") {
    return {
      hasAccessTable: false,
      hasSupremeLeader: false,
      isAuthorized: true,
      isSupremeLeader: false,
      role: null,
      record: null,
    };
  }

  if (!hasSupremeLeader) {
    const bootstrapped = await bootstrapSupremeLeader(supabase, user);
    if (bootstrapped) {
      return toAccessContext(true, true, bootstrapped);
    }
  }

  await ensurePendingAccessRequest(supabase, user);

  return {
    hasAccessTable: true,
    hasSupremeLeader: true,
    isAuthorized: false,
    isSupremeLeader: false,
    role: null,
    record: null,
  };
}

export async function listAccessRecords(): Promise<{ hasAccessTable: boolean; records: AccessRecord[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboard_user_access")
    .select("id, user_id, email, role, note, created_at, updated_at, created_by, updated_by")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    if (isMissingRelationError(error.message)) {
      return { hasAccessTable: false, records: [] };
    }

    throw new Error(`Failed to load dashboard access records: ${error.message}`);
  }

  return { hasAccessTable: true, records: ((data ?? []) as AccessRecord[]) };
}

export async function upsertAccessRecord(input: {
  id?: number | null;
  email?: string | null;
  userId?: string | null;
  role: Exclude<AccessRole, "supreme_leader">;
  note?: string | null;
  actorUserId: string;
}): Promise<void> {
  const supabase = await createClient();
  const email = normalizeEmail(input.email);
  const userId = normalizeString(input.userId);
  const note = normalizeNote(input.note);

  if (!(email || userId)) {
    throw new Error("Provide at least an email or a user ID.");
  }

  if (input.id) {
    const { error } = await supabase
      .from("dashboard_user_access")
      .update({
        email,
        user_id: userId,
        role: input.role,
        note,
        updated_at: new Date().toISOString(),
        updated_by: input.actorUserId,
      })
      .eq("id", input.id);

    if (error) {
      throw new Error(`Failed to update access record: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase.from("dashboard_user_access").insert({
    email,
    user_id: userId,
    role: input.role,
    note,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  });

  if (error) {
    throw new Error(`Failed to create access record: ${error.message}`);
  }
}

export async function deleteAccessRecord(id: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("dashboard_user_access").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete access record: ${error.message}`);
  }
}

async function findAccessRecord(
  supabase: SupabaseClient,
  user: User,
): Promise<{ kind: "ok"; record: AccessRecord | null } | { kind: "missing_table" }> {
  const filters: string[] = [];
  const userId = normalizeString(user.id);
  const email = normalizeEmail(user.email);

  if (userId) {
    filters.push(`user_id.eq.${escapeFilterValue(userId)}`);
  }

  if (email) {
    filters.push(`email.eq.${escapeFilterValue(email)}`);
  }

  if (filters.length === 0) {
    return { kind: "ok", record: null };
  }

  const { data, error } = await supabase
    .from("dashboard_user_access")
    .select("id, user_id, email, role, note, created_at, updated_at, created_by, updated_by")
    .or(filters.join(","))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error.message)) {
      return { kind: "missing_table" };
    }

    throw new Error(`Failed to load dashboard access record: ${error.message}`);
  }

  return { kind: "ok", record: (data as AccessRecord | null) ?? null };
}

async function checkHasSupremeLeader(supabase: SupabaseClient): Promise<boolean | "missing_table"> {
  const { count, error } = await supabase
    .from("dashboard_user_access")
    .select("id", { head: true, count: "exact" })
    .eq("role", "supreme_leader");

  if (error) {
    if (isMissingRelationError(error.message)) {
      return "missing_table";
    }

    throw new Error(`Failed to check supreme leader status: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function bootstrapSupremeLeader(supabase: SupabaseClient, user: User): Promise<AccessRecord | null> {
  const email = normalizeEmail(user.email);
  const userId = normalizeString(user.id);

  if (!userId) {
    return null;
  }

  const insertPayload = {
    user_id: userId,
    email,
    role: "supreme_leader" as const,
    note: "Bootstrapped as initial supreme leader.",
    created_by: userId,
    updated_by: userId,
  };

  const { data, error } = await supabase
    .from("dashboard_user_access")
    .insert(insertPayload)
    .select("id, user_id, email, role, note, created_at, updated_at, created_by, updated_by")
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return (data as AccessRecord | null) ?? null;
}

async function ensurePendingAccessRequest(supabase: SupabaseClient, user: User): Promise<void> {
  const userId = normalizeString(user.id);

  if (!userId) {
    return;
  }

  const { error } = await supabase.from("dashboard_user_access").insert({
    user_id: userId,
    email: normalizeEmail(user.email),
    role: "pending" satisfies AccessRole,
    note: "Pending admin approval.",
    created_by: userId,
    updated_by: userId,
  });

  if (error && !isConstraintViolation(error.message)) {
    throw new Error(`Failed to create pending access request: ${error.message}`);
  }
}

function toAccessContext(hasAccessTable: boolean, hasSupremeLeader: boolean, record: AccessRecord): AccessContext {
  const isSupremeLeader = record.role === "supreme_leader";
  const isAuthorized = isSupremeLeader || record.role === "authorized";

  return {
    hasAccessTable,
    hasSupremeLeader,
    isAuthorized,
    isSupremeLeader,
    role: record.role,
    record,
  };
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized ?? null;
}

function normalizeNote(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function escapeFilterValue(value: string): string {
  return value.replace(/,/g, "\\,");
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table") ||
    (normalized.includes("relation") && normalized.includes("does not exist"))
  );
}

function isConstraintViolation(message: string | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("duplicate key") || normalized.includes("unique constraint");
}
