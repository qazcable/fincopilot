"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { Money } from "./ui/primitives";
import { formatDayKey, weekdayOf } from "@/lib/domain/dates";
import { haptic } from "@/lib/client/telegram";

export type DayValue = { key: string; day: number; value: number; future: boolean };

/** Столбики трат по дням: нажатие показывает сумму дня и ведёт к его операциям */
export function DayBars({ days, today, monthQuery }: { days: DayValue[]; today: string; monthQuery: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...days.map(d => d.value));
  const picked = days.find(d => d.key === selected) ?? null;
  const lastDay = days.at(-1)?.day ?? 31;

  function pick(day: DayValue) {
    haptic.select();
    setSelected(current => (current === day.key ? null : day.key));
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">По дням</h2>
        <span className="text-[13px] text-muted">{picked ? `${formatDayKey(picked.key, today)}, ${weekdayOf(picked.key)}` : "Нажмите на столбик"}</span>
      </div>

      <div className="mt-4 flex h-28 items-end gap-[3px]">
        {days.map(day => (
          <button
            key={day.key}
            type="button"
            onClick={() => pick(day)}
            aria-label={`${day.day} число`}
            aria-pressed={selected === day.key}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <span
              className={clsx(
                "w-full rounded-t-[3px] transition-colors",
                selected === day.key ? "bg-fg" : day.key === today ? "bg-accent" : day.value > 0 ? "bg-accent/45" : day.future ? "bg-transparent" : "bg-surface-2"
              )}
              style={{ height: day.value > 0 ? `${Math.max(4, (day.value / max) * 100)}%` : "3px" }}
            />
          </button>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-faint tabular">
        <span>1</span><span>{Math.ceil(lastDay / 2)}</span><span>{lastDay}</span>
      </div>

      {picked && (
        picked.value > 0 ? (
          <Link
            href={`/history?${monthQuery}&day=${picked.key}`}
            className="pressable mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-3"
          >
            <span className="min-w-0 flex-1 text-[14px]">
              Потрачено <Money value={picked.value} className="font-semibold" />
            </span>
            <span className="text-[13px] font-medium text-accent">Операции</span>
            <ChevronRight className="size-4 text-faint" />
          </Link>
        ) : (
          <p className="mt-3 rounded-2xl bg-surface-2 px-3.5 py-3 text-[14px] text-muted">
            {picked.future ? "Этот день ещё не наступил" : "В этот день трат не было"}
          </p>
        )
      )}
    </div>
  );
}
