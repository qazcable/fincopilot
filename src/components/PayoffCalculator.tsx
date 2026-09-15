"use client";

import { useState } from "react";
import clsx from "clsx";
import { Card, Field, Money, Segmented, inputClass } from "./ui/primitives";
import { simulatePayoff, simulateStrategy, type Debt } from "@/lib/domain/payoff";
import { parseAmount } from "@/lib/domain/money";
import { plural } from "@/lib/domain/dates";
import { useCurrency } from "./CurrencyProvider";

function monthsText(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${plural(years, "год", "года", "лет")}`);
  if (rest > 0 || years === 0) parts.push(`${rest} ${plural(rest, "месяц", "месяца", "месяцев")}`);
  return parts.join(" ");
}

/** Проценты в расчёте приблизительные — показываем без тиынов */
const whole = (minor: number) => Math.round(minor / 100) * 100;

function amountOrZero(value: string) {
  return value.trim() ? parseAmount(value) ?? 0 : 0;
}

/** Досрочное погашение одного кредита: доплата каждый месяц и/или разовый взнос */
export function PayoffCalculator({ balance, ratePercent, monthlyPayment }: { balance: number; ratePercent: number; monthlyPayment: number }) {
  const { symbol } = useCurrency();
  const [extra, setExtra] = useState("");
  const [lump, setLump] = useState("");
  const base = simulatePayoff(balance, ratePercent, monthlyPayment);
  const extraMinor = amountOrZero(extra);
  const lumpMinor = amountOrZero(lump);
  const withExtra = simulatePayoff(balance, ratePercent, monthlyPayment, extraMinor, lumpMinor);
  const changed = extraMinor > 0 || lumpMinor > 0;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="text-[16px] font-semibold">Досрочное погашение</p>
        <p className="mt-0.5 text-[13px] text-muted">
          {base.feasible
            ? <>Сейчас: закроете за {monthsText(base.months)}, переплата <Money value={whole(base.totalInterest)} className="font-medium text-fg" /></>
            : "Платёж не покрывает проценты — долг не уменьшается"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Доплата в месяц, ${symbol}`}>
          <input value={extra} onChange={e => setExtra(e.target.value)} inputMode="decimal" placeholder="10 000" className={clsx(inputClass, "tabular")} />
        </Field>
        <Field label={`Разовый взнос, ${symbol}`}>
          <input value={lump} onChange={e => setLump(e.target.value)} inputMode="decimal" placeholder="100 000" className={clsx(inputClass, "tabular")} />
        </Field>
      </div>
      {changed && withExtra.feasible && base.feasible && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-positive-soft p-3">
            <p className="text-[12px] font-medium text-positive">Быстрее на</p>
            <p className="mt-0.5 text-[16px] font-bold">{monthsText(base.months - withExtra.months)}</p>
            <p className="text-[12px] text-muted">закроете за {monthsText(withExtra.months)}</p>
          </div>
          <div className="rounded-2xl bg-positive-soft p-3">
            <p className="text-[12px] font-medium text-positive">Экономия</p>
            <Money value={whole(base.totalInterest - withExtra.totalInterest)} className="mt-0.5 block text-[16px] font-bold" />
            <p className="text-[12px] text-muted">на процентах</p>
          </div>
        </div>
      )}
      {changed && withExtra.feasible && !base.feasible && (
        <p className="text-[13px] text-muted">С доплатой закроете за {monthsText(withExtra.months)}, переплата <Money value={whole(withExtra.totalInterest)} /></p>
      )}
      <p className="text-[12px] leading-snug text-faint">Расчёт примерный: проценты начисляются на остаток раз в месяц. Точный график уточняйте в банке.</p>
    </Card>
  );
}

/** Какой долг гасить первым: сравнение «сначала дорогой» и «сначала маленький» */
export function DebtStrategy({ debts }: { debts: Debt[] }) {
  const { symbol } = useCurrency();
  const [extra, setExtra] = useState("");
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");
  const extraMinor = amountOrZero(extra);
  const avalanche = simulateStrategy(debts, extraMinor, "avalanche");
  const snowball = simulateStrategy(debts, extraMinor, "snowball");
  const current = strategy === "avalanche" ? avalanche : snowball;
  const saving = avalanche.feasible && snowball.feasible ? snowball.totalInterest - avalanche.totalInterest : 0;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="text-[16px] font-semibold">Как быстрее закрыть все долги</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">Платите минимум по всем, а свободные деньги — на один долг. Когда он закрыт, его платёж идёт на следующий.</p>
      </div>
      <Field label={`Сколько можете доплачивать в месяц, ${symbol}`}>
        <input value={extra} onChange={e => setExtra(e.target.value)} inputMode="decimal" placeholder="20 000" className={clsx(inputClass, "tabular")} />
      </Field>
      <Segmented
        value={strategy}
        onChange={setStrategy}
        options={[{ value: "avalanche", label: "Сначала дорогой" }, { value: "snowball", label: "Сначала маленький" }]}
      />
      {current.feasible ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-[12px] font-medium text-muted">Без долгов через</p>
              <p className="mt-0.5 text-[16px] font-bold">{monthsText(current.months)}</p>
            </div>
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-[12px] font-medium text-muted">Переплата</p>
              <Money value={whole(current.totalInterest)} className="mt-0.5 block text-[16px] font-bold" />
            </div>
          </div>
          <ol className="space-y-1.5">
            {current.order.map((item, index) => (
              <li key={item.id} className="flex items-center gap-2.5 text-[14px]">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="text-[13px] text-muted">через {monthsText(item.month)}</span>
              </li>
            ))}
          </ol>
          {saving > 0 && (
            <p className="text-[13px] leading-snug text-muted">
              {strategy === "avalanche"
                ? <>«Сначала дорогой» экономит <Money value={whole(saving)} className="font-semibold text-positive" /> на процентах.</>
                : <>«Сначала маленький» дороже на <Money value={whole(saving)} className="font-semibold text-fg" />, зато первый долг закроется быстрее — это мотивирует.</>}
            </p>
          )}
        </>
      ) : (
        <p className="text-[14px] font-medium text-negative">Платежей не хватает, чтобы покрыть проценты. Увеличьте доплату.</p>
      )}
      <p className="text-[12px] leading-snug text-faint">Для долгов без ставки считается 0%. Укажите ставки в обязательствах для точного расчёта.</p>
    </Card>
  );
}
