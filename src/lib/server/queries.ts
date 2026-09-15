import "server-only";
import { prisma } from "./prisma";
import { getAccountBalances } from "./ledger";
import { ensureSchedule } from "./payments";
import { getBudgetSnapshot } from "./overview";
import { getMonthLimitLines } from "./limits";
import { limitProgress } from "@/lib/domain/limits";
import type { AppUser } from "./auth";
import { addDays, addMonths, dayKeyOf, instantToLocalInput, monthRange, parseKey } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";
import { NOT_TRANSIT, isTransitKey } from "@/lib/domain/constants";

export type CategoryDto = { id: string; name: string; emoji: string; color: string; kind: string };
export type AccountDto = { id: string; name: string; kind: string; balance: number; inBudget: boolean; isDefault: boolean };

export type TransactionDto = {
  id: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number;
  note: string | null;
  source: string;
  dayKey: string;
  time: string;
  localDateTime: string;
  accountId: string;
  accountName: string;
  // Только у переводов
  toAccountId: string | null;
  toAccountName: string | null;
  isPayment: boolean;
  // Транзит друзей: виден в истории, но не входит в суммы расходов и доходов
  transit: boolean;
  category: CategoryDto | null;
};

type TxWithRelations = Awaited<ReturnType<typeof loadTransactions>>[number];

function loadTransactions(userId: string, where: object, take?: number) {
  return prisma.transaction.findMany({
    where: { userId, ...where },
    include: { category: true, account: { select: { name: true } }, toAccount: { select: { name: true } } },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

function toTransactionDto(tx: TxWithRelations, timezone: string): TransactionDto {
  const local = instantToLocalInput(tx.occurredAt, timezone);
  return {
    id: tx.id,
    kind: tx.kind as TransactionDto["kind"],
    amount: fromDb(tx.amount),
    note: tx.note,
    source: tx.source,
    dayKey: local.slice(0, 10),
    time: local.slice(11),
    localDateTime: local,
    accountId: tx.accountId,
    accountName: tx.account.name,
    toAccountId: tx.toAccountId,
    toAccountName: tx.toAccount?.name ?? null,
    isPayment: tx.scheduledPaymentId !== null,
    transit: isTransitKey(tx.category?.key),
    category: tx.category && {
      id: tx.category.id, name: tx.category.name, emoji: tx.category.emoji, color: tx.category.color, kind: tx.category.kind,
    },
  };
}

export async function getCategories(userId: string): Promise<CategoryDto[]> {
  return prisma.category.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, name: true, emoji: true, color: true, kind: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getAccounts(userId: string): Promise<AccountDto[]> {
  return (await getAccountBalances(userId)).map(({ id, name, kind, balance, inBudget, isDefault }) => ({ id, name, kind, balance, inBudget, isDefault }));
}

/** Данные для формы операции, общие для всех экранов */
export async function getTransactionFormData(userId: string) {
  const [categories, accounts] = await Promise.all([getCategories(userId), getAccounts(userId)]);
  return { categories, accounts };
}

export async function getHomeData(user: AppUser) {
  const [snapshot, recent] = await Promise.all([
    getBudgetSnapshot(user),
    loadTransactions(user.id, {}, 6),
  ]);

  const horizonPayments = snapshot.pendingPayments.filter(p => p.dueOn < snapshot.horizon);
  const { year, month } = parseKey(snapshot.today);
  const limitWarnings = (await getMonthLimitLines(user, year, month))
    .map(line => ({ ...line, ...limitProgress(line.spent, line.limit) }))
    .filter(line => line.state !== "ok")
    .sort((a, b) => b.percent - a.percent);
  return {
    ...snapshot,
    limitWarnings,
    hour: Number(instantToLocalInput(new Date(), user.timezone).slice(11, 13)),
    upcoming: snapshot.pendingPayments.slice(0, 4),
    horizonPaymentsCount: horizonPayments.length,
    recent: recent.map(tx => toTransactionDto(tx, user.timezone)),
  };
}

export function parseMonthParam(value: string | undefined, timezone: string) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12 && year > 2000 && year < 2100) return { year, month };
  }
  const { year, month } = parseKey(dayKeyOf(new Date(), timezone));
  return { year, month };
}

export async function getHistory(user: AppUser, year: number, month: number) {
  const range = monthRange(year, month, user.timezone);
  const transactions = await loadTransactions(user.id, { occurredAt: { gte: range.from, lt: range.to } });
  const items = transactions.map(tx => toTransactionDto(tx, user.timezone));
  return {
    items,
    expense: items.filter(t => t.kind === "EXPENSE" && !t.transit).reduce((s, t) => s + t.amount, 0),
    income: items.filter(t => t.kind === "INCOME" && !t.transit).reduce((s, t) => s + t.amount, 0),
  };
}

export async function getStats(user: AppUser, year: number, month: number) {
  const current = monthRange(year, month, user.timezone);
  const prev = addMonths(year, month, -1);
  const previous = monthRange(prev.year, prev.month, user.timezone);

  const [transactions, previousExpense] = await Promise.all([
    loadTransactions(user.id, { occurredAt: { gte: current.from, lt: current.to } }),
    prisma.transaction.aggregate({
      where: { userId: user.id, kind: "EXPENSE", occurredAt: { gte: previous.from, lt: previous.to }, ...NOT_TRANSIT },
      _sum: { amount: true },
    }),
  ]);

  const items = transactions.map(tx => toTransactionDto(tx, user.timezone));
  const expenses = items.filter(t => t.kind === "EXPENSE" && !t.transit);

  const byCategory = new Map<string, { category: CategoryDto | null; total: number; count: number }>();
  for (const tx of expenses) {
    const key = tx.category?.id ?? "none";
    const entry = byCategory.get(key) ?? { category: tx.category, total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count++;
    byCategory.set(key, entry);
  }

  const byDay = new Map<string, number>();
  for (const tx of expenses) byDay.set(tx.dayKey, (byDay.get(tx.dayKey) ?? 0) + tx.amount);

  return {
    expense: expenses.reduce((s, t) => s + t.amount, 0),
    income: items.filter(t => t.kind === "INCOME" && !t.transit).reduce((s, t) => s + t.amount, 0),
    previousExpense: fromDb(previousExpense._sum.amount),
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total),
    byDay: Object.fromEntries(byDay),
    today: dayKeyOf(new Date(), user.timezone),
  };
}

export async function getPaymentsData(user: AppUser) {
  await ensureSchedule(user);
  const today = dayKeyOf(new Date(), user.timezone);

  const [obligations, pending, snapshot] = await Promise.all([
    prisma.obligation.findMany({
      where: { userId: user.id },
      orderBy: [{ completedAt: "asc" }, { dueDay: "asc" }],
    }),
    prisma.scheduledPayment.findMany({
      where: { userId: user.id, status: "PENDING", dueOn: { lte: addDays(today, 45) } },
      include: { obligation: { select: { title: true, kind: true } } },
      orderBy: { dueOn: "asc" },
    }),
    getBudgetSnapshot(user),
  ]);

  return {
    today,
    horizon: snapshot.horizon,
    hasIncomeSchedule: snapshot.hasIncomeSchedule,
    reserved: snapshot.budget.reserved,
    pending: pending.map(p => ({ id: p.id, dueOn: p.dueOn, amount: fromDb(p.amount), title: p.obligation.title, kind: p.obligation.kind })),
    obligations: obligations.map(o => ({
      id: o.id,
      title: o.title,
      kind: o.kind,
      monthlyAmount: fromDb(o.monthlyAmount),
      dueDay: o.dueDay,
      principalLeft: o.principalLeft === null ? null : fromDb(o.principalLeft),
      principalTotal: o.principalTotal === null ? null : fromDb(o.principalTotal),
      interestRate: o.interestRate,
      graceUntil: o.graceUntil ? dayKeyOf(o.graceUntil, user.timezone) : null,
      completed: o.completedAt !== null,
    })),
  };
}

export async function getObligation(user: AppUser, id: string) {
  const obligation = await prisma.obligation.findFirst({
    where: { id, userId: user.id },
    include: { payments: { orderBy: { dueOn: "desc" }, take: 24 } },
  });
  if (!obligation) return null;
  return {
    id: obligation.id,
    title: obligation.title,
    kind: obligation.kind,
    monthlyAmount: fromDb(obligation.monthlyAmount),
    dueDay: obligation.dueDay,
    principalLeft: obligation.principalLeft === null ? null : fromDb(obligation.principalLeft),
    principalTotal: obligation.principalTotal === null ? null : fromDb(obligation.principalTotal),
    interestRate: obligation.interestRate,
    graceUntil: obligation.graceUntil ? dayKeyOf(obligation.graceUntil, user.timezone) : null,
    completed: obligation.completedAt !== null,
    payments: obligation.payments.map(p => ({ id: p.id, dueOn: p.dueOn, amount: fromDb(p.amount), status: p.status })),
  };
}

export async function getSettingsData(user: AppUser) {
  const [accounts, incomes] = await Promise.all([
    getAccounts(user.id),
    prisma.recurringIncome.findMany({ where: { userId: user.id }, orderBy: { dayOfMonth: "asc" } }),
  ]);
  return {
    accounts,
    incomes: incomes.map(i => ({ id: i.id, title: i.title, dayOfMonth: i.dayOfMonth, amount: i.amount === null ? null : fromDb(i.amount) })),
    cushion: fromDb(user.cushion),
    timezone: user.timezone,
    remindersEnabled: user.remindersEnabled,
    morningDigest: user.morningDigest,
    eveningDigest: user.eveningDigest,
    weeklyDigest: user.weeklyDigest,
    apiKeyHint: user.apiKeyHint,
  };
}
