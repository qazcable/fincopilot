// Суммы внутри приложения — целые числа в минимальных единицах валюты пользователя (тиыны, центы).
// В базе — BigInt; конвертация на границе через toMinor/fromDb.
import { CURRENCIES, type CurrencyCode } from "./currency";

export const MINOR_PER_UNIT = 100;
export const MAX_AMOUNT_MINOR = 100_000_000_000 * MINOR_PER_UNIT;

export function fromDb(value: bigint | null | undefined): number {
  return value == null ? 0 : Number(value);
}

export function toDb(minor: number): bigint {
  return BigInt(Math.round(minor));
}

const THOUSAND_SUFFIX = /^(к|k|тыс\.?|тысяч[аи]?)$/i;

/**
 * Разбор суммы, введённой человеком: "1 200", "1200,50", "2.5к", "1,5 тыс".
 * Возвращает тиыны или null.
 */
export function parseAmount(input: string): number | null {
  const match = input
    .trim()
    .replace(/[\s  ]+/g, " ")
    .match(/^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(к|k|тыс\.?|тысяч[аи]?)?$/i);
  if (!match) return null;

  const whole = Number(match[1].replace(/ /g, ""));
  const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  let minor = whole * MINOR_PER_UNIT + fraction;
  if (match[3] && THOUSAND_SUFFIX.test(match[3])) minor *= 1000;

  if (!Number.isFinite(minor) || minor <= 0 || minor > MAX_AMOUNT_MINOR) return null;
  return Math.round(minor);
}

const groupFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const preciseFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 120000 → "1 200 ₸"; 120050 → "1 200,50 ₸" */
// Валюта по умолчанию для формата. На сервере её подставляет контекст запроса/пользователя (currency-context),
// в приложении компоненты передают валюту явно из CurrencyProvider.
let currencyResolver: (() => CurrencyCode | null | undefined) | null = null;

export function setCurrencyResolver(resolver: () => CurrencyCode | null | undefined) {
  currencyResolver = resolver;
}

export function currentCurrency(): CurrencyCode {
  return currencyResolver?.() ?? "KZT";
}

/** Приблизительная сумма в другой валюте: для крупных сумм без копеек */
export function formatApprox(minor: number, currency: CurrencyCode) {
  const rounded = Math.abs(minor) >= 100_000 ? Math.round(minor / 100) * 100 : minor;
  return `≈ ${formatMoney(rounded, { currency })}`;
}

/** currency: true — валюта пользователя, код — конкретная валюта, false — только число */
export function formatMoney(minor: number, options: { sign?: boolean; currency?: boolean | CurrencyCode } = {}) {
  const { sign = false, currency = true } = options;
  const code = currency === true ? currentCurrency() : currency === false ? null : currency;
  const abs = Math.abs(minor);
  const body = abs % MINOR_PER_UNIT === 0
    ? groupFormatter.format(abs / MINOR_PER_UNIT)
    : preciseFormatter.format(abs / MINOR_PER_UNIT);
  const prefix = minor < 0 ? "−" : sign && minor > 0 ? "+" : "";
  // Неразрывные пробелы, чтобы сумма не переносилась
  return `${prefix}${body}${code ? ` ${CURRENCIES[code].symbol}` : ""}`.replace(/\s/g, " ");
}

/** Для полей ввода: 120050 → "1200,5" */
export function minorToInput(minor: number | null | undefined) {
  if (minor == null) return "";
  const units = minor / MINOR_PER_UNIT;
  return Number.isInteger(units) ? String(units) : String(units).replace(".", ",");
}
