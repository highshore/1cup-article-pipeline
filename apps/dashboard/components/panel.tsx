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
    <section className="rounded-[22px] border border-slate-200/75 bg-white/80 p-4 shadow-panel md:rounded-[24px] md:p-6">
      <div className="mb-4 border-b border-slate-200/70 pb-4 md:mb-5">
        <h3 className="text-[1.22rem] font-semibold leading-tight text-ink md:text-[1.55rem]">{title}</h3>
        {subtitle ? <p className="mt-2 break-words text-[10px] uppercase tracking-[0.16em] text-ink/45 md:text-[11px] md:tracking-[0.18em]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
