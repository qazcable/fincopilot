import "server-only";
import { prisma } from "./prisma";
import { getAccountBalances } from "./ledger";
import { ensureSchedule } from "./payments";
import { calculateBudget, nextIncomeDate } from "@/lib/domain/budget";
import { dayKeyOf, startOfDayInstant, addDays } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";

type BudgetUser = { id: string; timezone: string; cushion: bigint };

/** Всё, что нужно для расчёта «можно тратить сегодня» — и для главного экрана, и для ответа бота */
export async function getBudgetSnapshot(user: BudgetUser) {
  await ensureSchedule(user);

  const today = dayKeyOf(new Date(), user.timezone);
  const [accounts, incomes, pending, spentTodayAgg] = await Promise.all([
    getAccountBalances(user.id),
    prisma.recurringIncome.findMany({ where: { userId: user.id } }),
    prisma.scheduledPayment.findMany({
      where: { userId: user.id, status: "PENDING" },
      include: { obligation: { select: { title: true, kind: true } } },
      orderBy: { dueOn: "asc" },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        kind: "EXPENSE",
        account: { inBudget: true },
        // Оплата по графику уже была в резерве — она не должна съедать лимит на день
        scheduledPaymentId: null,
        occurredAt: { gte: startOfDayInstant(today, user.timezone), lt: startOfDayInstant(addDays(today, 1), user.timezone) },
      },
      _sum: { amount: true },
    }),
  ]);

  const horizon = nextIncomeDate(today, incomes.map(i => i.dayOfMonth));
  const budgetBalance = accounts.filter(a => a.inBudget).reduce((sum, a) => sum + a.balance, 0);
  const pendingPayments = pending.map(p => ({
    id: p.id,
    dueOn: p.dueOn,
    amount: fromDb(p.amount),
    title: p.obligation.title,
    kind: p.obligation.kind,
  }));

  const spentToday = fromDb(spentTodayAgg._sum.amount);
  const budget = calculateBudget({
    today,
    horizon,
    balance: budgetBalance,
    cushion: fromDb(user.cushion),
    pendingPayments,
    spentToday,
  });

  // Лимит на завтра при текущем балансе — для вечерних итогов
  const tomorrow = addDays(today, 1);
  const tomorrowLimit = tomorrow < horizon
    ? calculateBudget({ today: tomorrow, horizon, balance: budgetBalance, cushion: fromDb(user.cushion), pendingPayments, spentToday: 0 }).dailyLimit
    : 0;

  return {
    today,
    horizon,
    hasIncomeSchedule: incomes.length > 0,
    accounts,
    totalBalance: accounts.reduce((sum, a) => sum + a.balance, 0),
    budgetBalance,
    pendingPayments,
    spentToday,
    tomorrowLimit,
    budget,
  };
}
