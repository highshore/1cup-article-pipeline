import { removeAccessRecord, saveAccessRecord } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { ShieldIcon } from "@/components/icons";
import { listAccessRecords, type AccessRecord } from "@/lib/access";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AccessPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const roleOptions: Array<{ value: "authorized" | "pending" | "blocked"; label: string }> = [
  { value: "authorized", label: "Authorized" },
  { value: "pending", label: "Pending" },
  { value: "blocked", label: "Blocked" },
];

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const { user, access } = await requireUser();
  const { hasAccessTable, records } = await listAccessRecords();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const status = getFirst(resolvedSearchParams?.status);

  return (
    <main className="mx-auto min-h-screen max-w-[1520px] px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mb-5">
        <AppNav />
      </div>

      <div className="mb-6 grid gap-4 sm:mb-8 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/78 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-dusk">
            <ShieldIcon className="h-4 w-4" />
            Dashboard Access
          </div>
          <h1 className="mt-3 text-[2rem] font-semibold leading-tight text-ink sm:text-[2.4rem] md:text-5xl">
            Manage who can enter after Kakao sign-in.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/75 md:text-base">
            Signed-in users must be marked as authorized here before they can move past the sign-in flow.
          </p>
        </div>

        <div className="w-full rounded-[24px] border border-slate-200/75 bg-white/80 px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:px-5 lg:w-auto lg:justify-self-end">
          <div className="text-xs uppercase tracking-[0.22em] text-ink/55">Current role</div>
          <div className="mt-3 text-xl font-semibold text-ink">{access.role ?? "authorized"}</div>
          <div className="mt-1 text-sm text-ink/70">{user.email ?? user.id}</div>
        </div>
      </div>

      {status ? <StatusBanner status={status} /> : null}

      {!hasAccessTable ? (
        <section className="grid min-h-[50vh] place-items-center rounded-[24px] border border-slate-200/70 bg-white/60 p-6 text-center sm:min-h-[60vh] sm:p-8 md:rounded-[28px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink/45">Supabase setup needed</p>
            <h2 className="mt-3 font-[family:var(--font-serif)] text-3xl text-ink sm:text-4xl">The access table is not in Supabase yet.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-ink/65">
              Run the updated schema in `apps/dashboard/supabase/schema.sql` so the dashboard can store authorized,
              pending, and blocked users in Supabase.
            </p>
          </div>
        </section>
      ) : (
        <div className="grid gap-4 md:gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-[24px] border border-slate-200/75 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:p-5 md:rounded-[28px]">
            <h2 className="text-lg font-semibold text-ink">Create access record</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              Add a user by email or Supabase user ID. If they already tried to sign in, they will usually appear as
              `pending` below automatically.
            </p>

            {access.isSupremeLeader ? (
              <form action={saveAccessRecord} className="mt-5 grid gap-3">
                <label className="grid gap-1 text-sm text-ink/80">
                  <span className="font-semibold">Email</span>
                  <input className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" name="email" type="email" />
                </label>
                <label className="grid gap-1 text-sm text-ink/80">
                  <span className="font-semibold">User ID</span>
                  <input className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" name="userId" type="text" />
                </label>
                <label className="grid gap-1 text-sm text-ink/80">
                  <span className="font-semibold">Role</span>
                  <select className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" defaultValue="authorized" name="role">
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-ink/80">
                  <span className="font-semibold">Note</span>
                  <textarea className="min-h-24 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" name="note" />
                </label>
                <button className="min-h-11 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90" type="submit">
                  Save access
                </button>
              </form>
            ) : (
              <div className="mt-5 rounded-2xl border border-slate-200/70 bg-slate-50 px-4 py-4 text-sm leading-6 text-ink/65">
                Read-only view. Only the `supreme_leader` can create or update access records.
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-slate-200/75 bg-white/84 p-4 shadow-panel backdrop-blur sm:p-5 md:rounded-[28px] md:p-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Access records</h2>
              <div className="text-xs uppercase tracking-[0.18em] text-ink/45">{records.length} entries</div>
            </div>

            <div className="grid gap-3">
              {records.length === 0 ? (
                <div className="rounded-3xl border border-slate-200/65 bg-white/60 px-4 py-12 text-center text-sm text-ink/60">
                  No access records yet.
                </div>
              ) : (
                records.map((record) => (
                  <AccessCard key={record.id} access={access.isSupremeLeader} record={record} />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function AccessCard({ access, record }: { access: boolean; record: AccessRecord }) {
  const isSupremeLeader = record.role === "supreme_leader";

  return (
    <div className="rounded-[24px] border border-slate-200/70 bg-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">{record.email || "No email recorded"}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-ink/45">{record.user_id ?? "No user ID recorded"}</div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/70">
          {record.role}
        </span>
      </div>

      {record.note ? <p className="mt-3 text-sm leading-6 text-ink/70">{record.note}</p> : null}

      <div className="mt-3 text-xs uppercase tracking-[0.16em] text-ink/40">Updated {formatTimestamp(record.updated_at)}</div>

      {access && !isSupremeLeader ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <form action={saveAccessRecord} className="grid gap-3">
            <input name="id" type="hidden" value={record.id} />
            <label className="grid gap-1 text-sm text-ink/80">
              <span className="font-semibold">Role</span>
              <select className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" defaultValue={record.role} name="role">
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-ink/80">
              <span className="font-semibold">Email</span>
              <input className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" defaultValue={record.email ?? ""} name="email" type="email" />
            </label>
            <label className="grid gap-1 text-sm text-ink/80">
              <span className="font-semibold">User ID</span>
              <input className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" defaultValue={record.user_id ?? ""} name="userId" type="text" />
            </label>
            <label className="grid gap-1 text-sm text-ink/80">
              <span className="font-semibold">Note</span>
              <textarea className="min-h-24 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none" defaultValue={record.note ?? ""} name="note" />
            </label>
            <button className="min-h-11 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90" type="submit">
              Update access
            </button>
          </form>

          <form action={removeAccessRecord} className="self-start">
            <input name="id" type="hidden" value={record.id} />
            <button className="min-h-11 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100" type="submit">
              Delete
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function StatusBanner({ status }: { status: string }) {
  const message =
    status === "created"
      ? "Access record created."
      : status === "updated"
        ? "Access record updated."
        : status === "deleted"
          ? "Access record deleted."
          : null;

  if (!message) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
      {message}
    </div>
  );
}

function getFirst(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
