"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { AmountDisplay, Keypad, inputToMinor } from "./AmountInput";
import { Button } from "./ui/primitives";
import { completeOnboarding } from "@/lib/actions/settings";
import { haptic } from "@/lib/client/telegram";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from "@/lib/domain/currency";
import { ONBOARDING_CURRENCIES } from "@/lib/domain/onboarding";
import { CurrencyProvider, useCurrency } from "./CurrencyProvider";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);


export function Onboarding({ firstName }: { firstName: string | null }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(useCurrency().currency);
  const [incomeDay, setIncomeDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish(day: number | null) {
    startTransition(async () => {
      const result = await completeOnboarding({ balance: inputToMinor(balance), incomeDay: day, incomeAmount: null, currency });
      if (result.ok) haptic.success();
      else setError(result.error);
    });
  }

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-6">
      <div className="flex h-14 items-center gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep(s => (s - 1) as 0 | 1)} aria-label="Назад" className="pressable -ml-2 flex size-10 items-center justify-center rounded-full text-muted">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="ml-auto flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span key={i} className={clsx("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-accent" : "w-1.5 bg-surface-3")} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <section key="intro" className="animate-rise-in flex flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-center">
            <div className="mb-8 flex size-20 items-center justify-center rounded-[28px] bg-accent text-4xl text-accent-fg shadow-[0_16px_40px_-12px_var(--accent)]">₸</div>
            <h1 className="text-[32px] font-bold leading-[1.1] tracking-tight">
              Привет{firstName ? `, ${firstName}` : ""}!<br />Посчитаем, сколько можно тратить
            </h1>
            <ul className="mt-6 space-y-3 text-[16px] text-muted">
              <li className="flex gap-3"><span aria-hidden className="w-6 shrink-0 text-center">💸</span> Лимит на день до зарплаты — с учётом кредитов и счетов</li>
              <li className="flex gap-3"><span aria-hidden className="w-6 shrink-0 text-center">🎙</span> Траты сообщением или голосом боту</li>
              <li className="flex gap-3"><span aria-hidden className="w-6 shrink-0 text-center">🔔</span> Напоминания о платежах, чтобы не было просрочек</li>
            </ul>
          </div>
          <Button size="lg" className="w-full" onClick={() => setStep(1)}>Начать</Button>
        </section>
      )}

      {step === 1 && (
        <section key="balance" className="animate-rise-in flex flex-1 flex-col">
          <h1 className="mt-4 text-[26px] font-bold tracking-tight">Сколько сейчас на карте?</h1>
          <p className="mt-1 text-[15px] text-muted">Текущий баланс основной карты. Потом добавите другие счета.</p>

          {/* Валюта учёта — выбирается один раз, потом меняется в настройках */}
          <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5">
            {ONBOARDING_CURRENCIES.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => { haptic.select(); setCurrency(code); }}
                className={clsx(
                  "pressable shrink-0 rounded-full px-3.5 py-2 text-[14px] font-medium",
                  currency === code ? "bg-accent text-accent-fg" : "bg-surface text-muted"
                )}
              >
                {CURRENCIES[code].flag} {code}
              </button>
            ))}
            <select
              value={ONBOARDING_CURRENCIES.includes(currency) ? "" : currency}
              onChange={e => e.target.value && setCurrency(e.target.value as CurrencyCode)}
              aria-label="Другая валюта"
              className="shrink-0 rounded-full bg-surface px-3 py-2 text-[14px] text-muted outline-none"
            >
              <option value="">Другая…</option>
              {CURRENCY_CODES.filter(code => !ONBOARDING_CURRENCIES.includes(code)).map(code => (
                <option key={code} value={code}>{CURRENCIES[code].flag} {code}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-1 items-center justify-center">
            <CurrencyProvider currency={currency} secondary={null} rates={[]} ratesDate={null}>
              <AmountDisplay value={balance} tone="EXPENSE" />
            </CurrencyProvider>
          </div>
          <div className="space-y-3">
            <Keypad value={balance} onChange={setBalance} />
            <Button size="lg" className="w-full" onClick={() => setStep(2)}>
              {inputToMinor(balance) ? "Дальше" : "Пропустить"}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section key="income" className="animate-rise-in flex flex-1 flex-col">
          <h1 className="mt-4 text-[26px] font-bold tracking-tight">Когда приходит зарплата?</h1>
          <p className="mt-1 text-[15px] text-muted">Лимит будет рассчитан так, чтобы денег хватило до этого дня.</p>

          <div className="mt-6 grid grid-cols-7 gap-2">
            {DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => { haptic.select(); setIncomeDay(day === incomeDay ? null : day); }}
                className={clsx(
                  "pressable tabular aspect-square rounded-2xl text-[16px] font-semibold",
                  incomeDay === day ? "bg-accent text-accent-fg" : "bg-surface text-fg"
                )}
              >
                {day}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-2 pt-6">
            {error && <p className="text-center text-[14px] text-negative">{error}</p>}
            <Button size="lg" className="w-full" loading={pending} disabled={!incomeDay} onClick={() => finish(incomeDay)}>
              {incomeDay ? `Каждое ${incomeDay} число` : "Выберите день"}
            </Button>
            <Button variant="ghost" size="md" className="w-full" disabled={pending} onClick={() => finish(null)}>
              Нет постоянной зарплаты
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
