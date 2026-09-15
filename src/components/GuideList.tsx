"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, ChevronRight, CircleHelp } from "lucide-react";
import { GUIDE_TOPICS } from "@/lib/domain/guide";
import { haptic } from "@/lib/client/telegram";

/** Темы инструкции раскрываются по нажатию; ссылка /guide#тема открывает нужную сразу */
export function GuideList() {
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!GUIDE_TOPICS.some(t => t.id === id)) return;
    // Раскрываем тему из ссылки после первой отрисовки
    const frame = requestAnimationFrame(() => {
      setOpen(id);
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="space-y-2.5">
      {GUIDE_TOPICS.map(topic => {
        const expanded = open === topic.id;
        return (
          <section key={topic.id} id={topic.id} className="scroll-mt-4 overflow-hidden rounded-3xl bg-surface shadow-card">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => { haptic.select(); setOpen(expanded ? null : topic.id); }}
              className="pressable flex w-full items-center gap-3 p-4 text-left"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl" aria-hidden>{topic.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{topic.title}</span>
                <span className={clsx("block text-[13px] leading-snug text-muted", !expanded && "truncate")}>{topic.what}</span>
              </span>
              <ChevronDown className={clsx("size-5 shrink-0 text-faint transition-transform", expanded && "rotate-180")} />
            </button>

            {expanded && (
              <div className="animate-rise-in space-y-3 px-4 pb-4">
                <div className="rounded-2xl bg-surface-2 p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Зачем</p>
                  <p className="mt-1 text-[15px] leading-snug">{topic.why}</p>
                </div>
                <div>
                  <p className="px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Как работает</p>
                  <ol className="mt-2 space-y-2">
                    {topic.how.map((step, index) => (
                      <li key={index} className="flex gap-3 text-[15px] leading-snug">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{index + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {topic.appPath && (
                  <Link href={topic.appPath} className="pressable flex items-center justify-between rounded-2xl bg-accent-soft px-4 py-3 text-[15px] font-semibold text-accent">
                    Перейти
                    <ChevronRight className="size-4" />
                  </Link>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Значок «?» рядом с блоком — ведёт к нужной теме инструкции */
export function HelpLink({ topic, className, label = "Как это работает" }: { topic: string; className?: string; label?: string }) {
  return (
    <Link
      href={`/guide#${topic}`}
      aria-label={label}
      title={label}
      onClick={event => { event.stopPropagation(); haptic.tap(); }}
      className={clsx("pressable inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:text-muted", className)}
    >
      <CircleHelp className="size-[18px]" />
    </Link>
  );
}
