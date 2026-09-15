import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ChevronRight, Settings, Sparkles, TrendingUp } from "lucide-react";
import { getForecast } from "@/lib/server/forecast";
import { forecastHeadline } from "@/lib/domain/forecast";
import { formatMoney } from "@/lib/domain/money";
import { requireUser } from "@/lib/server/auth";
import { getHomeData } from "@/lib/server/queries";
import { BudgetHero } from "@/components/BudgetHero";
import { LimitWarnings } from "@/components/LimitWarnings";
import { PaymentRow } from "@/components/PaymentRow";
import { TransactionList } from "@/components/TransactionList";
import { GoalProgress } from "@/components/GoalsBoard";
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
  const [data, forecast] = await Promise.all([getHomeData(user), getForecast(user)]);
  const headline = forecastHeadline(forecast, forecast.today, formatMoney, day => formatDayKey(day));
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

        <Link href="/forecast" className="pressable block">
          <Card className="flex items-center gap-3 p-4">
            <span className={clsx(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl",
              headline.tone === "good" ? "bg-positive-soft text-positive" : headline.tone === "warning" ? "bg-warning-soft text-warning" : "bg-negative-soft text-negative"
            )}>
              {headline.tone === "good" ? <TrendingUp className="size-5" /> : <AlertTriangle className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{headline.title}</span>
              <span className="block text-[13px] leading-snug text-muted">{headline.text}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-faint" />
          </Card>
        </Link>

        <LimitWarnings items={data.limitWarnings} />

        <Link href="/advisor" className="pressable block">
          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg">
              <Sparkles className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Спросить советника</span>
              <span className="block truncate text-[13px] text-muted">На чём сэкономить, успею ли к цели, какой кредит гасить</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-faint" />
          </Card>
        </Link>

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
              <p className="text-[13px] font-medium text-muted">{data.budget.reservedForGoals > 0 ? "Платежи и цели" : "На платежи"}</p>
              <Money value={data.budget.reserved} className="mt-1 block text-[20px] font-bold tracking-tight" />
              <p className="mt-0.5 text-[12px] text-faint">до {formatDayKey(data.horizon)}</p>
            </Card>
          </Link>
        </div>

        <section>
          <SectionHeader title="Цели" href="/goals" action={data.goals.length > 0 ? "Все" : "Создать"} />
          {data.goals.length > 0 ? (
            <Link href="/goals" className="pressable block">
              <Card className="space-y-4 p-4">
                {data.goals.slice(0, 3).map(goal => <GoalProgress key={goal.id} goal={goal} today={data.today} compact />)}
              </Card>
            </Link>
          ) : (
            <Link href="/goals" className="pressable block">
              <Card className="flex items-center gap-3 p-4">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-xl" aria-hidden>🎯</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">Копите на депозит?</span>
                  <span className="block text-[13px] text-muted">Поставьте цель — посчитаю, сколько откладывать</span>
                </span>
              </Card>
            </Link>
          )}
        </section>

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
