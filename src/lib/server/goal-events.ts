import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { daysBetween, dayKeyOf } from "@/lib/domain/dates";

export type ReachedGoal = { id: string; title: string; amount: number; days: number };

/**
 * Цели, которые только что стали выполненными. Отметка ставится условно —
 * поздравление уходит ровно один раз, даже если проверка запустится параллельно.
 * GOALS_BACKFILL_SILENT=1 — отметить без поздравлений (первый запуск на старых данных).
 */
export async function checkGoalsReached(userId: string): Promise<ReachedGoal[]> {
  const pending = await prisma.goal.count({ where: { userId, achievedAt: null } });
  if (pending === 0) return [];

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, timezone: true, cushion: true } });
  if (!user) return [];
  const snapshot = await getBudgetSnapshot(user);
  const goals = await prisma.goal.findMany({ where: { userId, achievedAt: null }, select: { id: true, createdAt: true } });

  const reached: ReachedGoal[] = [];
  for (const goal of goals) {
    const summary = snapshot.goals.find(g => g.id === goal.id);
    if (!summary || summary.targetAmount <= 0 || summary.saved < summary.targetAmount) continue;
    const { count } = await prisma.goal.updateMany({ where: { id: goal.id, achievedAt: null }, data: { achievedAt: new Date() } });
    if (count === 0) continue;
    reached.push({
      id: goal.id,
      title: summary.title,
      amount: summary.targetAmount,
      days: Math.max(0, daysBetween(dayKeyOf(goal.createdAt, user.timezone), snapshot.today)),
    });
  }
  return process.env.GOALS_BACKFILL_SILENT === "1" ? [] : reached;
}
