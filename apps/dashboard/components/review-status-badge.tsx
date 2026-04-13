import type { ReviewStatus } from "@/lib/articles";

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const styles = {
    pending: "border-slate-300 bg-slate-100 text-slate-700",
    approved: "border-moss/20 bg-moss/10 text-moss",
    deferred: "border-dusk/20 bg-dusk/10 text-dusk",
    rejected: "border-red-200 bg-red-50 text-red-700",
  }[status];

  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${styles}`}>
      {status}
    </span>
  );
}
