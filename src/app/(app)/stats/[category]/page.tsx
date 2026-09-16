import { notFound } from "next/navigation";
import clsx from "clsx";
import { TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getCategoryStats, parseMonthParam } from "@/lib/server/queries";
import { BackButton } from "@/components/TelegramBackButton";
import { TransactionList } from "@/components/TransactionList";
import { Card, CategoryIcon, EmptyState, Money, SectionHeader } from "@/components/ui/primitives";
import { ApproxMoney } from "@/components/CurrencyProvider";
import { monthName, parseKey, plural } from "@/lib/domain/dates";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const { category: categoryId } = await params;
  const { year, month } = parseMonthParam((await searchParams).month, user.timezone);
  const data = await getCategoryStats(user, year, month, categoryId);
  if (!data) notFound();

  const monthQuery = `month=${year}-${String(month).padStart(2, "0")}`;
  const name = data.category?.name ?? "Без категории";
  const color = data.category?.color ?? "#A1A1AA";
  const delta = data.previousTotal > 0 ? Math.round(((data.total - data.previousTotal) / data.previousTotal) * 100) : null;
  const limit = data.category?.monthlyLimit ?? null;
  const limitShare = limit ? Math.min(100, Math.round((data.total / limit) * 100)) : null;
  const average = data.count > 0 ? Math.round(data.total / data.count) : 0;
  const current = parseKey(data.today);
  const isCurrentMonth = year === current.year && month === current.month;

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href={`/stats?${monthQuery}`} label="Аналитика" />

      <header className="mb-5 mt-3 flex items-center gap-3 px-1">
        <CategoryIcon emoji={data.category?.emoji ?? "💸"} color={color} />
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight">{name}</h1>
          <p className="text-[14px] text-muted">{monthName(month)} {year}</p>
        </div>
      </header>

      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-muted">Потрачено</p>
          <Money value={data.total} className="mt-0.5 block text-[30px] font-bold tracking-tight" />
          <ApproxMoney value={data.total} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">
              {data.count} {plural(data.count, "операция", "операции", "операций")}
            </span>
            {average > 0 && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">
                в среднем <Money value={average} className="font-medium text-fg" />
              </span>
            )}
            {delta !== null && (
              <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold", delta > 0 ? "bg-negative-soft text-negative" : "bg-positive-soft text-positive")}>
                {delta > 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {delta > 0 ? "+" : ""}{delta}% к прошлому месяцу
              </span>
            )}
          </div>

          {limit !== null && limitShare !== null && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={clsx("h-full rounded-full", limitShare >= 100 ? "bg-negative" : limitShare >= 80 ? "bg-warning" : "bg-positive")}
                  style={{ width: `${limitShare}%` }}
                />
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                Лимит <Money value={limit} className="font-medium text-fg" /> · использовано {limitShare}%
                {limitShare < 100 && isCurrentMonth && <> · осталось <Money value={limit - data.total} className="font-medium text-fg" /></>}
              </p>
            </div>
          )}
        </Card>

        {data.count === 0 ? (
          <Card>
            <EmptyState emoji="🗂" title="Пусто" text={`В ${monthName(month).toLowerCase()} по этой категории трат не было.`} />
          </Card>
        ) : (
          <>
            {data.merchants.length > 1 && (
              <section>
                <SectionHeader title="Куда уходило" />
                <Card className="p-2">
                  {data.merchants.map(merchant => {
                    const share = Math.round((merchant.total / data.total) * 100);
                    return (
                      <div key={merchant.note} className="px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-medium">{merchant.note}</span>
                          <Money value={merchant.total} className="shrink-0 text-[15px] font-semibold" />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                          </div>
                          <span className="tabular w-16 shrink-0 text-right text-[12px] text-muted">
                            {merchant.count > 1 ? `${merchant.count} раза` : `${share}%`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}

            <section>
              <SectionHeader title="Все операции" />
              <div className="-mx-4">
                <TransactionList items={data.items} today={data.today} />
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
