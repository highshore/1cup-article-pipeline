"use client";

import { useState } from "react";

type TranslatableTextProps = {
  original: string;
  translated: string | null;
  kind: "title" | "subtitle" | "paragraph" | "summary";
};

export function TranslatableText({ original, translated, kind }: TranslatableTextProps) {
  const [open, setOpen] = useState(false);
  const hasTranslation = Boolean(translated?.trim());

  const textClassName =
    kind === "title"
      ? "font-[family:var(--font-serif)] text-3xl leading-tight text-ink md:text-4xl"
      : kind === "subtitle"
        ? "max-w-4xl text-lg leading-7 text-ink/72"
        : kind === "summary"
          ? "text-[15px] leading-7 text-ink/85"
        : "text-[15px] leading-7 text-ink/85";

  return (
    <div className={kind === "paragraph" ? "" : "w-full"}>
      <button
        className="w-full text-left"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div className={textClassName}>{original}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink/45">
          <span
            className={[
              "rounded-full border px-2 py-1",
              hasTranslation ? "border-moss/15 bg-moss/10 text-moss" : "border-slate-200 bg-slate-100/80 text-ink/55",
            ].join(" ")}
          >
            {hasTranslation ? "KO ready" : "KO missing"}
          </span>
          <span>{open ? "Hide translation" : "Click to reveal translation"}</span>
        </div>
      </button>

      {open ? (
        <div className="mt-3 rounded-2xl border border-slate-200/70 bg-shell/58 px-4 py-3 text-[15px] leading-7 text-ink/80">
          {hasTranslation ? translated : `No Korean translation is stored for this ${kind}.`}
        </div>
      ) : null}
    </div>
  );
}
