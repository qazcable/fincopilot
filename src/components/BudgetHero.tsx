import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { Money } from "./ui/primitives";
import type { BudgetResult } from "@/lib/domain/budget";
import { formatDayKey, pluralDays } from "@/lib/domain/dates";

const STATUS = {
  good: { label: "В плане", pill: "bg-positive-soft text-positive", bar: "bg-positive", glow: "var(--positive)" },
  tight: { label: "Почти всё", pill: "bg-warning-soft text-warning", bar: "bg-warning", glow: "var(--warning)" },
  over: { label: "Перерасход", pill: "bg-negative-soft text-negative", bar: "bg-negative", glow: "var(--negative)" },
} as const;

export function BudgetHero({
  budget,
  horizon,
  today,
  hasIncomeSchedule,
}: { budget: BudgetResult; horizon: string; today: string; hasIncomeSchedule: boolean }) {
  const status = STATUS[budget.status];
  const spent = budget.dailyLimit - budget.leftToday;
  const progress = budget.dailyLimit > 0 ? Math.min(100, Math.max(0, (spent / budget.dailyLimit) * 100)) : 100;
  const shortfall = budget.free < 0;

  return (
    <section className="relative overflow-hidden rounded-[32px] bg-surface p-5 shadow-card">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full opacity-[0.16] blur-3xl"
        style={{ background: status.glow }}
      />

      <div className="relative flex items-center justify-between">
        <p className="text-[14px] font-medium text-muted">Можно потратить сегодня</p>
        <span className={clsx("rounded-full px-2.5 py-1 text-[12px] font-semibold", status.pill)}>{status.label}</span>
      </div>

      <Money
        value={shortfall ? budget.free : budget.leftToday}
        className={clsx("relative mt-2 block text-[46px] font-bold leading-none tracking-tight", (shortfall || budget.leftToday < 0) && "text-negative")}
        currencyClassName="text-[0.55em] text-faint"
      />

      <div className="relative mt-5">
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className={clsx("h-full rounded-full transition-all duration-700", status.bar)} style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[13px] text-muted">
          <span>
            Потрачено <Money value={Math.max(0, spent)} className="font-medium text-fg" /> из <Money value={budget.dailyLimit} />
          </span>
        </div>
      </div>

      <div className="relative mt-4 border-t border-line pt-3.5 text-[13px] leading-snug text-muted">
        {shortfall ? (
          <>До {formatDayKey(horizon, today).toLowerCase()} не хватает <Money value={-budget.free} className="font-semibold text-negative" /> на обязательные платежи</>
        ) : (
          <>Лимит на {pluralDays(budget.daysLeft)} — до {hasIncomeSchedule ? "зарплаты " : ""}{formatDayKey(horizon, today).toLowerCase()}. {budget.reservedForGoals > 0 ? "Платежи, цели и подушка" : "Платежи и подушка"} уже вычтены.</>
        )}
        {!hasIncomeSchedule && (
          <Link href="/settings#incomes" className="mt-2 flex items-center font-medium text-accent">
            Указать день зарплаты <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
    </section>
  );
}
