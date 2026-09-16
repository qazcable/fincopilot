// Первая настройка: общие правила для приложения и для диалога в боте
import { parseAmount } from "./money";
import type { CurrencyCode } from "./currency";

export const ONBOARDING_CURRENCIES: CurrencyCode[] = ["KZT", "USD", "EUR", "RUB", "KGS", "UZS"];

/** Остаток на карте, как его пишут люди: «185 000», «185000 ₸», «0», «1,5к» — в минимальных единицах */
export function parseBalanceInput(text: string): number | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[₸$€₽]|тенге|тг\.?|руб\.?|сом|usd|kzt|eur|rub/g, "")
    .trim();
  if (/^0+([.,]0+)?$/.test(cleaned)) return 0;
  return parseAmount(cleaned);
}

/** День зарплаты: число от 1 до 31 */
export function parseDay(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2})(?:-?(?:е|го|ое|число))?$/i);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/** Шаги диалога в боте */
export type BotOnboardingStep = "balance" | "day" | "amount";

export type BotOnboardingData = {
  balance?: number;
  currency?: CurrencyCode;
  day?: number | null;
};
