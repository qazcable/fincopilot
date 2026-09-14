// Суммы внутри приложения — целые числа в тиынах (number, безопасно до 9e13 ₸).
// В базе — BigInt; конвертация на границе через toMinor/fromDb.

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
export function formatMoney(minor: number, options: { sign?: boolean; currency?: boolean } = {}) {
  const { sign = false, currency = true } = options;
  const abs = Math.abs(minor);
  const body = abs % MINOR_PER_UNIT === 0
    ? groupFormatter.format(abs / MINOR_PER_UNIT)
    : preciseFormatter.format(abs / MINOR_PER_UNIT);
  const prefix = minor < 0 ? "−" : sign && minor > 0 ? "+" : "";
  // Неразрывные пробелы, чтобы сумма не переносилась
  return `${prefix}${body}${currency ? " ₸" : ""}`.replace(/\s/g, " ");
}

/** Для полей ввода: 120050 → "1200,5" */
export function minorToInput(minor: number | null | undefined) {
  if (minor == null) return "";
  const units = minor / MINOR_PER_UNIT;
  return Number.isInteger(units) ? String(units) : String(units).replace(".", ",");
}
