import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getStats, parseMonthParam } from "@/lib/server/queries";
import { getLimitsOverview } from "@/lib/server/limits";
import { LimitsCard } from "@/components/LimitsCard";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { Donut } from "@/components/Donut";
import { DayBars } from "@/components/DayBars";
import { ApproxMoney } from "@/components/CurrencyProvider";
import { Card, CategoryIcon, EmptyState, Money, PageHeader } from "@/components/ui/primitives";
import { daysInMonth, makeKey, monthName, parseKey } from "@/lib/domain/dates";

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser();
  const { year, month } = parseMonthParam((await searchParams).month, user.timezone);
  const [stats, limits] = await Promise.all([getStats(user, year, month), getLimitsOverview(user, year, month)]);
  const current = parseKey(stats.today);

  const delta = stats.previousExpense > 0 ? Math.round(((stats.expense - stats.previousExpense) / stats.previousExpense) * 100) : null;
  const days = daysInMonth(year, month);
  const dayValues = Array.from({ length: days }, (_, i) => {
    const key = makeKey(year, month, i + 1);
    return { key, day: i + 1, value: stats.byDay[key] ?? 0, future: key > stats.today };
  });
  const monthQuery = `month=${year}-${String(month).padStart(2, "0")}`;
  const elapsedDays = year === current.year && month === current.month ? current.day : days;
  const averagePerDay = Math.round(stats.expense / Math.max(1, elapsedDays));

  return (
    <main className="safe-top">
      <PageHeader title="Аналитика" help="limits" />
      <div className="space-y-4 px-4">
        <MonthSwitcher basePath="/stats" year={year} month={month} currentYear={current.year} currentMonth={current.month} />

        <div id="limits">
          <LimitsCard items={limits} monthLabel={monthName(month).toLowerCase()} />
        </div>

        {stats.expense === 0 ? (
          <Card>
            <EmptyState emoji="📊" title="Нет расходов" text="Когда появятся траты, здесь будет разбивка по категориям и дням." />
          </Card>
        ) : (
          <>
            <Card className="p-5">
              <Donut segments={stats.categories.map(c => ({
                value: c.total,
                color: c.category?.color ?? "#A1A1AA",
                label: c.category?.name ?? "Без категории",
                href: `/stats/${c.category?.id ?? "none"}?${monthQuery}`,
              }))}>
                <span className="text-[13px] text-muted">Потрачено</span>
                <Money value={stats.expense} className="text-[22px] font-bold tracking-tight" />
                <ApproxMoney value={stats.expense} />
                {delta !== null && (
                  <span className={clsx("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold", delta > 0 ? "bg-negative-soft text-negative" : "bg-positive-soft text-positive")}>
                    {delta > 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                    {delta > 0 ? "+" : ""}{delta}%
                  </span>
                )}
              </Donut>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-surface-2 px-2 py-3">
                  <p className="text-[12px] text-muted">В день</p>
                  <Money value={averagePerDay} className="mt-0.5 block text-[15px] font-semibold" />
                </div>
                <div className="rounded-2xl bg-surface-2 px-2 py-3">
                  <p className="text-[12px] text-muted">Доходы</p>
                  <Money value={stats.income} className="mt-0.5 block text-[15px] font-semibold text-positive" />
                </div>
                <div className="rounded-2xl bg-surface-2 px-2 py-3">
                  <p className="text-[12px] text-muted">Прошлый</p>
                  <Money value={stats.previousExpense} className="mt-0.5 block text-[15px] font-semibold" />
                </div>
              </div>
              {(stats.peer.in > 0 || stats.peer.out > 0) && (
                <p className="mt-3 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[12px] leading-snug text-muted">
                  🔄 Переводы и наличные по сальдо: от людей пришло <Money value={stats.peer.in} className="font-medium text-fg" />, людям и наличными ушло <Money value={stats.peer.out} className="font-medium text-fg" />.
                  {" "}{stats.peer.out > stats.peer.in ? "В расходах — только разница." : stats.peer.in > stats.peer.out ? "В доходах — только разница." : "Взаимно погасились."}
                </p>
              )}
            </Card>

            <Card className="p-5">
              <DayBars days={dayValues} today={stats.today} monthQuery={monthQuery} />
            </Card>

            <Card className="p-2">
              {stats.categories.map(entry => {
                const share = Math.round((entry.total / stats.expense) * 100);
                return (
                  <Link
                    key={entry.category?.id ?? "none"}
                    href={`/stats/${entry.category?.id ?? "none"}?${monthQuery}`}
                    className="pressable flex items-center gap-3 px-3 py-2.5"
                  >
                    <CategoryIcon emoji={entry.category?.emoji ?? "💸"} color={entry.category?.color ?? "#A1A1AA"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium">{entry.category?.name ?? "Без категории"}</span>
                        <Money value={entry.total} className="text-[15px] font-semibold" />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: entry.category?.color ?? "#A1A1AA" }} />
                        </div>
                        <span className="tabular w-9 text-right text-[12px] text-muted">{share}%</span>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-faint" />
                  </Link>
                );
              })}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
