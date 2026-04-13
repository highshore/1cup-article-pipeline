export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200/75 bg-white/80 p-5 shadow-panel md:p-6">
      <div className="mb-5 border-b border-slate-200/70 pb-4">
        <h3 className="text-[1.4rem] font-semibold leading-tight text-ink md:text-[1.55rem]">{title}</h3>
        {subtitle ? <p className="mt-2 break-all text-[11px] uppercase tracking-[0.18em] text-ink/45">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
