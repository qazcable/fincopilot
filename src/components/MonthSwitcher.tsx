"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthName } from "@/lib/domain/dates";
import { haptic } from "@/lib/client/telegram";

function monthParam(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function MonthSwitcher({
  basePath,
  year,
  month,
  currentYear,
  currentMonth,
  query = "",
}: { basePath: string; year: number; month: number; currentYear: number; currentMonth: number; query?: string }) {
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const isCurrent = year === currentYear && month === currentMonth;
  const suffix = query ? `&${query}` : "";

  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface p-1 shadow-card">
      <Link
        href={`${basePath}?month=${monthParam(prev.year, prev.month)}${suffix}`}
        onClick={() => haptic.select()}
        aria-label="Предыдущий месяц"
        className="pressable flex size-10 items-center justify-center rounded-xl text-muted active:bg-surface-2"
      >
        <ChevronLeft className="size-5" />
      </Link>
      <span className="text-[15px] font-semibold">
        {monthName(month)}{year !== currentYear ? ` ${year}` : ""}
      </span>
      {isCurrent ? (
        <span className="size-10" />
      ) : (
        <Link
          href={`${basePath}?month=${monthParam(next.year, next.month)}${suffix}`}
          onClick={() => haptic.select()}
          aria-label="Следующий месяц"
          className="pressable flex size-10 items-center justify-center rounded-xl text-muted active:bg-surface-2"
        >
          <ChevronRight className="size-5" />
        </Link>
      )}
    </div>
  );
}
