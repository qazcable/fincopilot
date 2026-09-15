import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/server/auth";
import { getHistory, parseMonthParam } from "@/lib/server/queries";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { TransactionList } from "@/components/TransactionList";
import { AddFirstTransaction } from "@/components/AddFirstTransaction";
import { Card, EmptyState, Money, PageHeader } from "@/components/ui/primitives";
import { dayKeyOf, parseKey } from "@/lib/domain/dates";

const FILTERS = [
  { value: "all", label: "Все" },
  { value: "expense", label: "Расходы" },
  { value: "income", label: "Доходы" },
] as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ month?: string; kind?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const { year, month } = parseMonthParam(params.month, user.timezone);
  const today = dayKeyOf(new Date(), user.timezone);
  const current = parseKey(today);
  const filter = FILTERS.find(f => f.value === params.kind)?.value ?? "all";

  const history = await getHistory(user, year, month);
  const items = filter === "all" ? history.items : history.items.filter(t => t.kind === (filter === "expense" ? "EXPENSE" : "INCOME"));
  const monthQuery = `month=${year}-${String(month).padStart(2, "0")}`;

  return (
    <main className="safe-top">
      <PageHeader title="История" help="record" />
      <div className="space-y-4 px-4">
        <MonthSwitcher basePath="/history" year={year} month={month} currentYear={current.year} currentMonth={current.month} query={filter !== "all" ? `kind=${filter}` : ""} />

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <p className="text-[13px] font-medium text-muted">Расходы</p>
            <Money value={history.expense} className="mt-1 block text-[20px] font-bold tracking-tight" />
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-medium text-muted">Доходы</p>
            <Money value={history.income} className="mt-1 block text-[20px] font-bold tracking-tight text-positive" />
          </Card>
        </div>

        <div className="flex gap-2">
          {FILTERS.map(f => (
            <Link
              key={f.value}
              href={`/history?${monthQuery}${f.value !== "all" ? `&kind=${f.value}` : ""}`}
              replace
              className={clsx(
                "pressable rounded-full px-4 py-2 text-[14px] font-medium",
                filter === f.value ? "bg-fg text-bg" : "bg-surface text-muted shadow-card"
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {items.length > 0 ? (
          <TransactionList items={items} today={today} />
        ) : (
          <Card>
            <EmptyState emoji="🧾" title="Здесь пока пусто" text="В этом месяце нет операций с таким фильтром.">
              <AddFirstTransaction />
            </EmptyState>
          </Card>
        )}
      </div>
    </main>
  );
}
