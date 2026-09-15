import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getForecast } from "@/lib/server/forecast";
import { BackButton } from "@/components/TelegramBackButton";
import { ForecastChart } from "@/components/ForecastChart";
import { Card, Money, SectionHeader } from "@/components/ui/primitives";
import { forecastHeadline } from "@/lib/domain/forecast";
import { formatDayKey, weekdayOf } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";

export default async function ForecastPage() {
  const user = await requireUser();
  const forecast = await getForecast(user);
  const headline = forecastHeadline(forecast, forecast.today, formatMoney, day => formatDayKey(day));
  const eventDays = forecast.points.filter(p => p.events.length > 0);

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/" label="Главная" />
      <h1 className="mb-1 mt-3 px-1 text-[28px] font-bold tracking-tight">Прогноз остатка</h1>
      <p className="mb-5 px-1 text-[14px] text-muted">Деньги на счетах в лимите на 45 дней вперёд</p>

      <Card className="p-4">
        <div className={clsx(
          "mb-4 flex gap-3 rounded-2xl p-3",
          headline.tone === "good" ? "bg-positive-soft" : headline.tone === "warning" ? "bg-warning-soft" : "bg-negative-soft"
        )}>
          {headline.tone === "good"
            ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
            : <AlertTriangle className={clsx("mt-0.5 size-5 shrink-0", headline.tone === "warning" ? "text-warning" : "text-negative")} />}
          <div>
            <p className="text-[15px] font-semibold">{headline.title}</p>
            <p className="text-[13px] leading-snug text-muted">{headline.text}</p>
          </div>
        </div>
        <ForecastChart points={forecast.points} today={forecast.today} gapStart={forecast.gapStart} />
      </Card>

      <section className="mt-6">
        <SectionHeader title="Из чего складывается" />
        <Card className="divide-y divide-line px-4">
          <div className="flex items-center justify-between py-3 text-[15px]">
            <span>Сейчас на счетах в лимите</span>
            <Money value={forecast.points[0].balance} className="font-semibold" />
          </div>
          <div className="flex items-center justify-between py-3 text-[15px]">
            <span>
              Обычные траты в день
              <span className="block text-[12px] text-muted">среднее за 30 дней без самых крупных трат; переводы и наличные — по сальдо</span>
            </span>
            <Money value={forecast.dailySpend} className="font-semibold" />
          </div>
          {forecast.incomes.map(income => (
            <div key={`${income.title}-${income.dayOfMonth}`} className="flex items-center justify-between py-3 text-[15px]">
              <span>
                {income.title}, {income.dayOfMonth} числа
                <span className="block text-[12px] text-muted">{income.amount === 0 ? "сумма неизвестна" : income.estimated ? "сумма по истории поступлений" : "сумма из настроек"}</span>
              </span>
              <Money value={income.amount} className="font-semibold text-positive" />
            </div>
          ))}
        </Card>
        {(!forecast.hasIncomeSchedule || forecast.incomeUnknown) && (
          <Link href="/settings#incomes" className="pressable mt-3 flex items-center justify-between rounded-2xl bg-warning-soft px-4 py-3 text-[14px] font-medium text-warning">
            {forecast.hasIncomeSchedule ? "Укажите сумму зарплаты для точного прогноза" : "Укажите день и сумму зарплаты"}
            <ChevronRight className="size-4" />
          </Link>
        )}
      </section>

      {eventDays.length > 0 && (
        <section className="mt-6">
          <SectionHeader title="Доходы и платежи" />
          <Card className="divide-y divide-line px-4">
            {eventDays.flatMap(day => day.events.map((event, index) => (
              <div key={`${day.day}-${index}`} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{event.title}</span>
                  <span className="block text-[12px] text-muted">{formatDayKey(day.day, forecast.today)}, {weekdayOf(day.day)} · остаток {formatMoney(day.balance)}</span>
                </span>
                <Money value={event.amount} sign className={clsx("shrink-0 font-semibold", event.amount > 0 && "text-positive")} />
              </div>
            )))}
          </Card>
        </section>
      )}

      <p className="mt-6 px-1 pb-4 text-[12px] leading-snug text-faint">
        Прогноз примерный: траты считаются одинаковыми каждый день, цели и накопления не учитываются. Чем полнее история операций, тем точнее.
      </p>
    </main>
  );
}
