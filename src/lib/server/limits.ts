import "server-only";
import { prisma } from "./prisma";
import { addMonths, dayKeyOf, monthRange, parseKey } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";
import { monthKeyOf, reachedLevels, type LimitLevel } from "@/lib/domain/limits";
import type { LimitLine } from "@/lib/domain/digest";

type LimitsUser = { id: string; timezone: string };

async function spentByCategory(userId: string, from: Date, to: Date, categoryIds?: string[]) {
  const rows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { userId, kind: "EXPENSE", occurredAt: { gte: from, lt: to }, ...(categoryIds ? { categoryId: { in: categoryIds } } : {}) },
    _sum: { amount: true },
  });
  return new Map(rows.map(r => [r.categoryId, fromDb(r._sum.amount)]));
}

/** Категории расходов с лимитами и тратами за месяц (для итогов и чеков) */
export async function getMonthLimitLines(user: LimitsUser, year: number, month: number): Promise<LimitLine[]> {
  const categories = await prisma.category.findMany({
    where: { userId: user.id, kind: "EXPENSE", archivedAt: null, monthlyLimit: { not: null } },
    orderBy: { sortOrder: "asc" },
  });
  if (categories.length === 0) return [];
  const range = monthRange(year, month, user.timezone);
  const spent = await spentByCategory(user.id, range.from, range.to, categories.map(c => c.id));
  return categories.map(c => ({ emoji: c.emoji, name: c.name, limit: fromDb(c.monthlyLimit), spent: spent.get(c.id) ?? 0 }));
}

export type LimitsOverviewItem = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  limit: number | null;
  spent: number;
  // Средние траты за 3 предыдущих месяца — подсказка при выборе лимита
  averageSpent: number;
};

/** Все категории расходов с лимитами, тратами за месяц и средним за 3 прошлых месяца */
export async function getLimitsOverview(user: LimitsUser, year: number, month: number): Promise<LimitsOverviewItem[]> {
  const current = monthRange(year, month, user.timezone);
  const start = addMonths(year, month, -3);
  const history = { from: monthRange(start.year, start.month, user.timezone).from, to: current.from };

  const [categories, spent, past] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id, kind: "EXPENSE", archivedAt: null }, orderBy: { sortOrder: "asc" } }),
    spentByCategory(user.id, current.from, current.to),
    spentByCategory(user.id, history.from, history.to),
  ]);

  return categories.map(c => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    limit: c.monthlyLimit === null ? null : fromDb(c.monthlyLimit),
    spent: spent.get(c.id) ?? 0,
    averageSpent: Math.round((past.get(c.id) ?? 0) / 3),
  }));
}

/**
 * Состояние лимита категории после изменения операции в месяце `at`.
 * Впервые достигнутые пороги (80/100%) записываются, чтобы каждое предупреждение пришло один раз.
 */
export async function evaluateCategoryLimit(user: LimitsUser, categoryId: string | null, at: Date) {
  if (!categoryId) return null;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId: user.id, kind: "EXPENSE" } });
  if (!category || category.monthlyLimit === null) return null;

  const dayKey = dayKeyOf(at, user.timezone);
  const { year, month } = parseKey(dayKey);
  const range = monthRange(year, month, user.timezone);
  const spent = (await spentByCategory(user.id, range.from, range.to, [category.id])).get(category.id) ?? 0;
  const limit = fromDb(category.monthlyLimit);
  const line: LimitLine = { emoji: category.emoji, name: category.name, spent, limit };

  const monthKey = monthKeyOf(dayKey);
  const reached = reachedLevels(spent, limit);
  let newLevel: LimitLevel | null = null;
  if (reached.length > 0) {
    const existing = await prisma.categoryLimitAlert.findMany({ where: { categoryId: category.id, month: monthKey } });
    const fresh = reached.filter(level => !existing.some(a => a.level === level));
    if (fresh.length > 0) {
      await prisma.categoryLimitAlert.createMany({
        data: fresh.map(level => ({ userId: user.id, categoryId: category.id, month: monthKey, level })),
        skipDuplicates: true,
      });
      newLevel = fresh[fresh.length - 1];
    }
  }
  return { line, newLevel };
}
