"use client";

import { createContext, useContext } from "react";
import { CURRENCIES, convertMinor, type CurrencyCode, type NbkRate } from "@/lib/domain/currency";
import { formatApprox, formatMoney } from "@/lib/domain/money";

type CurrencyContextValue = {
  currency: CurrencyCode;
  secondary: CurrencyCode | null;
  rates: NbkRate[];
  ratesDate: string | null;
};

const CurrencyContext = createContext<CurrencyContextValue>({ currency: "KZT", secondary: null, rates: [], ratesDate: null });

export function CurrencyProvider({ children, ...value }: CurrencyContextValue & { children: React.ReactNode }) {
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/** Валюта пользователя, курсы Нацбанка и готовые функции формата */
export function useCurrency() {
  const context = useContext(CurrencyContext);
  const symbol = CURRENCIES[context.currency].symbol;
  return {
    ...context,
    symbol,
    format: (minor: number, options: { sign?: boolean } = {}) => formatMoney(minor, { ...options, currency: context.currency }),
    /** «≈ 85 $» во второй валюте или null, если пересчёт не нужен/невозможен */
    approx: (minor: number, to: CurrencyCode | null = context.secondary) => {
      if (!to || to === context.currency) return null;
      const converted = convertMinor(minor, context.currency, to, context.rates);
      return converted === null ? null : formatApprox(converted, to);
    },
  };
}

/** Сумма во второй валюте мелким текстом: «≈ 85,20 $» */
export function ApproxMoney({ value, className }: { value: number; className?: string }) {
  const { approx } = useCurrency();
  const text = approx(value);
  return text ? <span className={className ?? "block text-[12px] text-muted tabular"}>{text}</span> : null;
}
