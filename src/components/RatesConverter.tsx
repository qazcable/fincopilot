"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowDownUp } from "lucide-react";
import { CURRENCIES, CURRENCY_CODES, convertMinor, type CurrencyCode } from "@/lib/domain/currency";
import { formatMoney, parseAmount } from "@/lib/domain/money";
import { useCurrency } from "./CurrencyProvider";
import { inputClass } from "./ui/primitives";
import { haptic } from "@/lib/client/telegram";

/** Конвертер по курсу Нацбанка: сумма в одной валюте → в другой */
export function RatesConverter() {
  const { currency, secondary, rates } = useCurrency();
  const [from, setFrom] = useState<CurrencyCode>(secondary ?? (currency === "KZT" ? "USD" : "KZT"));
  const [to, setTo] = useState<CurrencyCode>(currency);
  const [amount, setAmount] = useState("100");

  const minor = parseAmount(amount);
  const result = minor ? convertMinor(minor, from, to, rates) : null;
  const available = CURRENCY_CODES.filter(code => code === "KZT" || rates.some(r => r.code === code));

  function swap() {
    haptic.select();
    setFrom(to);
    setTo(from);
  }

  const select = (value: CurrencyCode, onChange: (code: CurrencyCode) => void, label: string) => (
    <select
      value={value}
      aria-label={label}
      onChange={e => onChange(e.target.value as CurrencyCode)}
      className="h-12 shrink-0 rounded-2xl bg-surface-2 px-3 text-[15px] font-semibold outline-none"
    >
      {available.map(code => <option key={code} value={code}>{CURRENCIES[code].flag} {code}</option>)}
    </select>
  );

  return (
    <div className="space-y-2 rounded-3xl bg-surface p-4 shadow-card">
      <p className="px-1 text-[15px] font-semibold">Конвертер</p>
      <div className="flex gap-2">
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="100" className={clsx(inputClass, "tabular")} aria-label="Сумма" />
        {select(from, setFrom, "Из валюты")}
      </div>
      <div className="flex justify-center">
        <button type="button" onClick={swap} aria-label="Поменять валюты местами" className="pressable flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted">
          <ArrowDownUp className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <div className="flex h-12 flex-1 items-center rounded-2xl bg-accent-soft px-4 text-[18px] font-bold tabular text-accent">
          {result !== null ? formatMoney(result, { currency: to }) : "—"}
        </div>
        {select(to, setTo, "В валюту")}
      </div>
    </div>
  );
}
