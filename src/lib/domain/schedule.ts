import { addMonths, clampedDay, parseKey, type DayKey } from "./dates";

export type ScheduleInput = {
  monthlyAmount: number;
  dueDay: number;
  startsOn: DayKey;
  // null — у платежа нет тела долга (регулярный счёт)
  principalLeft: number | null;
};

export type ExistingPayment = { dueOn: DayKey; amount: number; status: string };

/**
 * Какие платежи нужно досоздать до horizon (включительно).
 * Существующие даты не трогаем; сумма ограничивается остатком долга
 * за вычетом ещё не оплаченных платежей.
 */
export function planPayments(input: ScheduleInput, existing: ExistingPayment[], horizon: DayKey) {
  // Один платёж на месяц: если в месяце уже есть платёж (даже на другой день) — не создаём второй
  const knownMonths = new Set(existing.map(p => p.dueOn.slice(0, 7)));
  let debtLeft = input.principalLeft === null
    ? Infinity
    : input.principalLeft - existing.filter(p => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);

  const planned: { dueOn: DayKey; amount: number }[] = [];
  const start = parseKey(input.startsOn);

  for (let i = 0; i < 36; i++) {
    const { year, month } = addMonths(start.year, start.month, i);
    const dueOn = clampedDay(year, month, input.dueDay);
    if (dueOn > horizon) break;
    if (dueOn < input.startsOn || knownMonths.has(dueOn.slice(0, 7))) continue;
    if (debtLeft <= 0) break;

    const amount = Math.min(input.monthlyAmount, debtLeft);
    planned.push({ dueOn, amount });
    debtLeft -= amount;
  }
  return planned;
}
