import clsx from "clsx";
import { TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { getNbkRates } from "@/lib/server/rates";
import { BackButton } from "@/components/TelegramBackButton";
import { HelpLink } from "@/components/GuideList";
import { RatesConverter } from "@/components/RatesConverter";
import { Card, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { CURRENCIES, POPULAR_RATES, convertMinor, currencyCode, isCurrencyCode, type NbkRate } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/domain/money";

const rateNumber = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function RatesPage() {
  const user = await requireUser();
  const currency = currencyCode(user.currency);
  const { date, rates } = await getNbkRates();

  const popular = POPULAR_RATES.map(code => rates.find(r => r.code === code)).filter((r): r is NbkRate => Boolean(r));
  const others = rates.filter(r => !POPULAR_RATES.includes(r.code)).sort((a, b) => a.code.localeCompare(b.code));

  // Курс в валюте пользователя: за 1 единицу валюты. Для тенге — официальный курс как есть
  const value = (rate: NbkRate) => currency === "KZT" ? rate.rate : (convertMinor(100, rate.code, currency, rates) ?? 0) / 100;

  const row = (rate: NbkRate) => {
    const info = isCurrencyCode(rate.code) ? CURRENCIES[rate.code] : null;
    return (
      <div key={rate.code} className="flex items-center gap-3 px-4 py-3">
        <span className="w-7 text-center text-xl" aria-hidden>{info?.flag ?? "💱"}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{rate.code}</span>
          <span className="block truncate text-[12px] text-muted">{info?.name ?? "Валюта"}</span>
        </span>
        <span className="text-right">
          <span className="block text-[15px] font-semibold tabular">{rateNumber.format(value(rate))} {CURRENCIES[currency].symbol}</span>
          {currency === "KZT" && rate.direction !== "SAME" && (
            <span className={clsx("flex items-center justify-end gap-0.5 text-[12px] tabular", rate.direction === "UP" ? "text-negative" : "text-positive")}>
              {rate.direction === "UP" ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {rate.change > 0 ? "+" : ""}{rateNumber.format(rate.change)}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <main className="safe-top px-4 pt-4">
      <BackButton href="/" label="Главная" />
      <h1 className="mb-1 mt-3 flex items-center gap-1 px-1 text-[28px] font-bold tracking-tight">Курсы валют <HelpLink topic="currency" /></h1>
      <p className="mb-5 px-1 text-[14px] text-muted">
        Официальный курс Национального банка РК{date ? ` на ${date.split("-").reverse().join(".")}` : ""}
      </p>

      {rates.length === 0 ? (
        <Card><EmptyState emoji="🏦" title="Курсы недоступны" text="Сайт Нацбанка не ответил. Попробуйте открыть экран чуть позже." /></Card>
      ) : (
        <div className="space-y-6">
          <RatesConverter />
          <section>
            <SectionHeader title="Основные" />
            <Card className="divide-y divide-line">{popular.map(row)}</Card>
          </section>
          <section>
            <SectionHeader title="Все валюты" />
            <Card className="divide-y divide-line">{others.map(row)}</Card>
          </section>
          <p className="px-1 pb-4 text-[12px] leading-snug text-faint">
            {currency === "KZT"
              ? "Стрелка — изменение официального курса за день: рост курса валюты означает, что тенге подешевел."
              : `Курсы пересчитаны в ${CURRENCIES[currency].short} через тенге по официальному курсу. Пример: 100 $ = ${formatMoney(convertMinor(10_000, "USD", currency, rates) ?? 0, { currency })}.`}
          </p>
        </div>
      )}
    </main>
  );
}
