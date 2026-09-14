import { addMonths, clampedDay, daysBetween, makeKey, parseKey, type DayKey } from "./dates";

/** Ближайшая дата дохода строго после сегодня; без доходов — 1-е число следующего месяца */
export function nextIncomeDate(today: DayKey, incomeDays: number[]): DayKey {
  const { year, month } = parseKey(today);
  const candidates = incomeDays.flatMap(day => {
    const thisMonth = clampedDay(year, month, day);
    const next = addMonths(year, month, 1);
    return [thisMonth, clampedDay(next.year, next.month, day)];
  }).filter(key => key > today);

  if (candidates.length === 0) {
    const next = addMonths(year, month, 1);
    return makeKey(next.year, next.month, 1);
  }
  return candidates.sort()[0];
}

export type BudgetInput = {
  today: DayKey;
  horizon: DayKey;
  // Баланс счетов, участвующих в бюджете
  balance: number;
  cushion: number;
  pendingPayments: { dueOn: DayKey; amount: number }[];
  // Расходы, совершённые сегодня (уже вычтены из баланса)
  spentToday: number;
};

export type BudgetResult = {
  reserved: number;
  free: number;
  daysLeft: number;
  dailyLimit: number;
  leftToday: number;
  status: "good" | "tight" | "over";
};

/**
 * Лимит на день до следующего дохода:
 * (баланс − платежи до дохода, включая просроченные − подушка) / дни.
 * Лимит фиксируется на начало дня, поэтому сегодняшние траты прибавляются обратно.
 */
export function calculateBudget(input: BudgetInput): BudgetResult {
  const reserved = input.pendingPayments
    .filter(p => p.dueOn < input.horizon)
    .reduce((sum, p) => sum + p.amount, 0);

  const free = input.balance - reserved - input.cushion;
  const daysLeft = Math.max(1, daysBetween(input.today, input.horizon));
  const dailyLimit = Math.max(0, Math.floor((free + input.spentToday) / daysLeft / 100) * 100);
  const leftToday = dailyLimit - input.spentToday;

  let status: BudgetResult["status"] = "good";
  if (free < 0 || leftToday < 0) status = "over";
  else if (leftToday < dailyLimit * 0.25) status = "tight";

  return { reserved, free, daysLeft, dailyLimit, leftToday, status };
}
