import Link from "next/link";
import { Settings } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getHomeData } from "@/lib/server/queries";
import { BudgetHero } from "@/components/BudgetHero";
import { PaymentRow } from "@/components/PaymentRow";
import { TransactionList } from "@/components/TransactionList";
import { AddFirstTransaction } from "@/components/AddFirstTransaction";
import { Card, EmptyState, Money, SectionHeader } from "@/components/ui/primitives";
import { capitalize, formatDayKey, plural, weekdayOf } from "@/lib/domain/dates";

function greeting(hour: number) {
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export default async function HomePage() {
  const user = await requireUser();
  const data = await getHomeData(user);
  const weekday = weekdayOf(data.today);

  return (
    <main className="safe-top">
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <div>
          <p className="text-[13px] font-medium text-muted">
            {capitalize(weekday)}, {formatDayKey(data.today)}
          </p>
          <h1 className="text-[22px] font-bold tracking-tight">
            {greeting(data.hour)}{user.firstName ? `, ${user.firstName}` : ""}
          </h1>
        </div>
        <Link href="/settings" aria-label="Настройки" className="pressable flex size-11 items-center justify-center rounded-full bg-surface text-muted shadow-card">
          <Settings className="size-5" />
        </Link>
      </header>

      <div className="space-y-6 px-4">
        <BudgetHero
          budget={data.budget}
          horizon={data.horizon}
          today={data.today}
          hasIncomeSchedule={data.hasIncomeSchedule}
        />

        <div className="grid grid-cols-2 gap-3">
          <Link href="/settings" className="pressable block">
            <Card className="h-full p-4">
              <p className="text-[13px] font-medium text-muted">На счетах</p>
              <Money value={data.totalBalance} className="mt-1 block text-[20px] font-bold tracking-tight" />
              <p className="mt-0.5 truncate text-[12px] text-faint">
                {data.accounts.length === 1 ? data.accounts[0].name : `${data.accounts.length} ${plural(data.accounts.length, "счёт", "счёта", "счетов")}`}
              </p>
            </Card>
          </Link>
          <Link href="/payments" className="pressable block">
            <Card className="h-full p-4">
              <p className="text-[13px] font-medium text-muted">На платежи</p>
              <Money value={data.budget.reserved} className="mt-1 block text-[20px] font-bold tracking-tight" />
              <p className="mt-0.5 text-[12px] text-faint">до {formatDayKey(data.horizon)}</p>
            </Card>
          </Link>
        </div>

        <section>
          <SectionHeader title="Ближайшие платежи" href="/payments" />
          {data.upcoming.length > 0 ? (
            <Card className="p-1.5">
              {data.upcoming.map(payment => <PaymentRow key={payment.id} payment={payment} today={data.today} />)}
            </Card>
          ) : (
            <Card>
              <EmptyState emoji="🗓️" title="Платежей пока нет" text="Добавьте кредиты, рассрочки и регулярные счета — они будут учтены в лимите.">
                <Link href="/payments/new" className="pressable inline-flex h-10 items-center rounded-full bg-accent-soft px-4 text-[14px] font-semibold text-accent">
                  Добавить платёж
                </Link>
              </EmptyState>
            </Card>
          )}
        </section>

        <section>
          <SectionHeader title="Последние операции" href="/history" />
          {data.recent.length > 0 ? (
            <TransactionList items={data.recent} today={data.today} />
          ) : (
            <Card>
              <EmptyState emoji="✍️" title="Запишите первую трату" text="Нажмите «+» внизу или отправьте боту сообщение «кофе 1200».">
                <AddFirstTransaction />
              </EmptyState>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
