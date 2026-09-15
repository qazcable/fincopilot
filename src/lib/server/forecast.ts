import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { addDays, addMonths, dayKeyOf, monthRange, parseKey, startOfDayInstant } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";
import { expectedMonthlyIncome, forecastBalance, typicalDailySpend } from "@/lib/domain/forecast";
import { DEBT_CATEGORY_KEY } from "@/lib/domain/constants";

type ForecastUser = { id: string; timezone: string; cushion: bigint };

export const FORECAST_DAYS = 45;
const SPEND_HISTORY_DAYS = 30;

/** Прогноз остатка на счетах в лимите: зарплата, платежи по графику и обычные траты по истории */
export async function getForecast(user: ForecastUser, days = FORECAST_DAYS) {
  const snapshot = await getBudgetSnapshot(user);
  const { today } = snapshot;
  const { year, month } = parseKey(today);
  const historyFrom = addDays(today, -SPEND_HISTORY_DAYS);

  const [incomes, expenses, salaryMonths] = await Promise.all([
    prisma.recurringIncome.findMany({ where: { userId: user.id }, orderBy: { dayOfMonth: "asc" } }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        kind: "EXPENSE",
        account: { inBudget: true },
        // Платежи по графику учтены отдельно — в обычные траты не входят
        scheduledPaymentId: null,
        NOT: { category: { key: DEBT_CATEGORY_KEY } },
        occurredAt: { gte: startOfDayInstant(historyFrom, user.timezone), lt: startOfDayInstant(today, user.timezone) },
      },
      select: { amount: true, occurredAt: true },
    }),
    Promise.all([-3, -2, -1].map(async delta => {
      const m = addMonths(year, month, delta);
      const range = monthRange(m.year, m.month, user.timezone);
      const sum = await prisma.transaction.aggregate({
        where: { userId: user.id, kind: "INCOME", category: { key: "salary" }, occurredAt: { gte: range.from, lt: range.to } },
        _sum: { amount: true },
      });
      return fromDb(sum._sum.amount);
    })),
  ]);

  const byDay = new Map<string, number>();
  for (const tx of expenses) {
    const day = dayKeyOf(tx.occurredAt, user.timezone);
    byDay.set(day, (byDay.get(day) ?? 0) + fromDb(tx.amount));
  }
  const dailySpend = typicalDailySpend([...byDay.values()], SPEND_HISTORY_DAYS);

  // Сумма зарплаты: указанная в настройках, иначе — средняя по истории, поровну между днями выплат без суммы
  const estimatedSalary = expectedMonthlyIncome(salaryMonths);
  const withoutAmount = incomes.filter(i => i.amount === null).length;
  const incomeItems = incomes.map(i => ({
    title: i.title,
    dayOfMonth: i.dayOfMonth,
    amount: i.amount !== null ? fromDb(i.amount) : withoutAmount > 0 ? Math.round(estimatedSalary / withoutAmount / 100) * 100 : 0,
    estimated: i.amount === null,
  }));

  const result = forecastBalance({
    today,
    days,
    balance: snapshot.budgetBalance,
    dailySpend,
    incomes: incomeItems,
    payments: snapshot.pendingPayments.map(p => ({ title: p.title, dueOn: p.dueOn, amount: p.amount })),
  });

  return {
    ...result,
    today,
    dailySpend,
    incomes: incomeItems,
    hasIncomeSchedule: incomes.length > 0,
    incomeUnknown: incomeItems.some(i => i.amount === 0),
  };
}

export type Forecast = Awaited<ReturnType<typeof getForecast>>;
