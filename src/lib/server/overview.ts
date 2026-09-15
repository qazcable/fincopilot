import "server-only";
import { prisma } from "./prisma";
import { getAccountBalances } from "./ledger";
import { ensureSchedule } from "./payments";
import { calculateBudget, nextIncomeDate } from "@/lib/domain/budget";
import { dayKeyOf, startOfDayInstant, addDays } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";
import { NOT_TRANSIT } from "@/lib/domain/constants";
import { previousIncomeDate, summarizeGoals } from "@/lib/domain/goals";

type BudgetUser = { id: string; timezone: string; cushion: bigint };

/** Всё, что нужно для расчёта «можно тратить сегодня» — и для главного экрана, и для ответа бота */
export async function getBudgetSnapshot(user: BudgetUser) {
  await ensureSchedule(user);

  const today = dayKeyOf(new Date(), user.timezone);
  const [accounts, incomes, goalRows, pending, spentTodayAgg] = await Promise.all([
    getAccountBalances(user.id),
    prisma.recurringIncome.findMany({ where: { userId: user.id } }),
    prisma.goal.findMany({ where: { userId: user.id, account: { archivedAt: null } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
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
        // Транзит друзей — не траты
        ...NOT_TRANSIT,
        occurredAt: { gte: startOfDayInstant(today, user.timezone), lt: startOfDayInstant(addDays(today, 1), user.timezone) },
      },
      _sum: { amount: true },
    }),
  ]);

  const incomeDays = incomes.map(i => i.dayOfMonth);
  const horizon = nextIncomeDate(today, incomeDays);
  const goals = await loadGoalSummary(user, goalRows, accounts, today, incomeDays);
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
    goalReserve: goals.reserve,
  });

  // Лимит на завтра при текущем балансе — для вечерних итогов
  const tomorrow = addDays(today, 1);
  const tomorrowLimit = tomorrow < horizon
    ? calculateBudget({ today: tomorrow, horizon, balance: budgetBalance, cushion: fromDb(user.cushion), pendingPayments, spentToday: 0, goalReserve: goals.reserve }).dailyLimit
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
    goals: goals.items,
  };
}

type GoalRow = { id: string; accountId: string; title: string; emoji: string; targetAmount: bigint; targetDate: string | null };

async function loadGoalSummary(
  user: BudgetUser,
  rows: GoalRow[],
  accounts: { id: string; balance: number }[],
  today: string,
  incomeDays: number[]
) {
  if (rows.length === 0) return { items: [], reserve: 0 };
  const accountIds = [...new Set(rows.map(g => g.accountId))];
  const since = startOfDayInstant(previousIncomeDate(today, incomeDays), user.timezone);
  const [incoming, outgoing] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["toAccountId"],
      where: { userId: user.id, kind: "TRANSFER", toAccountId: { in: accountIds }, occurredAt: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { userId: user.id, kind: "TRANSFER", accountId: { in: accountIds }, occurredAt: { gte: since } },
      _sum: { amount: true },
    }),
  ]);
  const periodInflow = new Map(accountIds.map(id => [
    id,
    fromDb(incoming.find(s => s.toAccountId === id)?._sum.amount) - fromDb(outgoing.find(s => s.accountId === id)?._sum.amount),
  ]));
  return summarizeGoals({
    goals: rows.map(g => ({ id: g.id, accountId: g.accountId, title: g.title, emoji: g.emoji, targetAmount: fromDb(g.targetAmount), targetDate: g.targetDate })),
    balances: new Map(accounts.map(a => [a.id, a.balance])),
    periodInflow,
    today,
    incomeDays,
  });
}
