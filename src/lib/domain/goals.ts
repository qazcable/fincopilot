// Цели накоплений: распределение баланса счёта между целями и план взносов
import { addMonths, clampedDay, daysBetween, makeKey, parseKey, type DayKey } from "./dates";
import { nextIncomeDate } from "./budget";

export type GoalInput = { id: string; targetAmount: number; targetDate: DayKey | null };

/** Баланс счёта заполняет цели по порядку: сначала первая, остаток — следующей */
export function allocateGoalSavings(accountBalance: number, goals: GoalInput[]) {
  let left = Math.max(0, accountBalance);
  return goals.map(goal => {
    const saved = Math.min(goal.targetAmount, left);
    left -= saved;
    return { id: goal.id, saved, remaining: goal.targetAmount - saved, percent: goal.targetAmount > 0 ? Math.floor((saved / goal.targetAmount) * 100) : 0 };
  });
}

/** Последний день дохода не позже сегодня; без доходов — 1-е число текущего месяца */
export function previousIncomeDate(today: DayKey, incomeDays: number[]): DayKey {
  const { year, month } = parseKey(today);
  const prev = addMonths(year, month, -1);
  const candidates = incomeDays
    .flatMap(day => [clampedDay(year, month, day), clampedDay(prev.year, prev.month, day)])
    .filter(key => key <= today)
    .sort();
  return candidates.at(-1) ?? makeKey(year, month, 1);
}

/** Сколько раз придёт доход с сегодняшнего дня (не включая) до даты цели (включая) */
export function incomesUntil(today: DayKey, target: DayKey, incomeDays: number[]) {
  let count = 0;
  let cursor = today;
  // Без расписания доходов считаем «доход» = начало каждого месяца
  const days = incomeDays.length > 0 ? incomeDays : [1];
  for (let i = 0; i < 1000; i++) {
    const next = nextIncomeDate(cursor, days);
    if (next > target) break;
    count++;
    cursor = next;
  }
  return count;
}

export type GoalPlan = {
  // Сколько откладывать с каждого дохода до срока
  perIncome: number;
  incomesLeft: number;
  daysLeft: number;
  status: "done" | "no_deadline" | "overdue" | "on_track";
};

export function planGoal(remaining: number, today: DayKey, targetDate: DayKey | null, incomeDays: number[]): GoalPlan {
  if (remaining <= 0) return { perIncome: 0, incomesLeft: 0, daysLeft: 0, status: "done" };
  if (!targetDate) return { perIncome: 0, incomesLeft: 0, daysLeft: 0, status: "no_deadline" };
  const daysLeft = daysBetween(today, targetDate);
  if (daysLeft < 0) return { perIncome: remaining, incomesLeft: 0, daysLeft, status: "overdue" };
  const incomesLeft = incomesUntil(today, targetDate, incomeDays);
  // Если до срока доходов не будет — всю сумму нужно отложить из текущих денег
  const perIncome = Math.ceil(remaining / Math.max(1, incomesLeft + 1) / 100) * 100;
  return { perIncome, incomesLeft, daysLeft, status: "on_track" };
}

export type GoalRecord = GoalInput & { accountId: string; title: string; emoji: string };

export type GoalSummary = GoalRecord & {
  saved: number;
  remaining: number;
  percent: number;
  plan: GoalPlan;
  // Сколько отложить на эту цель в текущем периоде (с последнего дохода до следующего)
  plannedThisPeriod: number;
};

/**
 * Цели по всем счетам: сколько накоплено, план взносов и сколько ещё отложить до следующего дохода.
 * `periodInflow` — чистые переводы на счёт с последнего дохода: план считается от остатка на начало периода,
 * чтобы уже сделанный перевод не уменьшал сам план, а засчитывался в него.
 */
export function summarizeGoals(input: {
  goals: GoalRecord[];
  balances: Map<string, number>;
  periodInflow: Map<string, number>;
  today: DayKey;
  incomeDays: number[];
}) {
  const items: GoalSummary[] = [];
  let reserve = 0;
  const accountIds = [...new Set(input.goals.map(g => g.accountId))];

  for (const accountId of accountIds) {
    const goals = input.goals.filter(g => g.accountId === accountId);
    const balance = input.balances.get(accountId) ?? 0;
    const inflow = input.periodInflow.get(accountId) ?? 0;
    const now = allocateGoalSavings(balance, goals);
    const atPeriodStart = allocateGoalSavings(balance - Math.max(0, inflow), goals);

    let planned = 0;
    goals.forEach((goal, i) => {
      const plan = planGoal(now[i].remaining, input.today, goal.targetDate, input.incomeDays);
      const startPlan = planGoal(atPeriodStart[i].remaining, input.today, goal.targetDate, input.incomeDays);
      // Просроченные и бессрочные цели не урезают лимит на день
      const plannedThisPeriod = startPlan.status === "on_track" ? Math.min(startPlan.perIncome, atPeriodStart[i].remaining) : 0;
      planned += plannedThisPeriod;
      items.push({ ...goal, ...now[i], plan, plannedThisPeriod });
    });
    reserve += goalReserve(planned, inflow);
  }

  // Порядок как у исходного списка
  const order = new Map(input.goals.map((g, i) => [g.id, i]));
  items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { items, reserve };
}

/**
 * Сколько нужно отложить на цели в текущем периоде (с последнего дохода до следующего),
 * за вычетом уже переведённого на счёт накоплений в этом периоде.
 */
export function goalReserve(plannedThisPeriod: number, transferredThisPeriod: number) {
  return Math.max(0, plannedThisPeriod - transferredThisPeriod);
}
