import "server-only";
import { prisma } from "./prisma";
import { dayKeyOf } from "@/lib/domain/dates";
import { toDb } from "@/lib/domain/money";
import { FREE_LIMITS, TRIAL_DAYS, extendUntil, extendUntilDays, planState, type PlanState, type PlanUser } from "@/lib/domain/plan";

export type { PlanState };

type QuotaUser = PlanUser & { id: string; timezone: string };

export function getPlan(user: PlanUser) {
  return planState(user);
}

/** Пробный Pro на 14 дней — выдаётся один раз, при первом входе */
export async function startTrial(userId: string) {
  const until = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.user.updateMany({
    where: { id: userId, trialEndsAt: null, plan: "FREE" },
    data: { trialEndsAt: until },
  });
  return count > 0;
}

/** Сколько разборов ИИ уже потрачено в этом месяце (на бесплатном тарифе) */
export async function aiUsed(user: QuotaUser) {
  const month = dayKeyOf(new Date(), user.timezone).slice(0, 7);
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { aiMonth: true, aiCount: true } });
  return current?.aiMonth === month ? current.aiCount : 0;
}

/**
 * Разрешает обращение к ИИ и списывает его из месячного лимита.
 * На Pro лимита нет, счётчик не трогаем.
 */
export async function consumeAi(user: QuotaUser): Promise<boolean> {
  if (planState(user).pro) return true;
  const month = dayKeyOf(new Date(), user.timezone).slice(0, 7);
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { aiMonth: true, aiCount: true } });
  const used = current?.aiMonth === month ? current.aiCount : 0;
  if (used >= FREE_LIMITS.aiPerMonth) return false;
  await prisma.user.update({ where: { id: user.id }, data: { aiMonth: month, aiCount: used + 1 } });
  return true;
}

/** На бесплатном тарифе выписку банка можно загрузить один раз */
export async function canImport(user: QuotaUser) {
  if (planState(user).pro) return true;
  const used = await prisma.importBatch.count({ where: { userId: user.id, status: "APPLIED" } });
  return used < FREE_LIMITS.imports;
}

/** Оплата подписки: продлевает Pro и сохраняет платёж для учёта выручки */
export async function grantPro(userId: string, months: number, options: { amount?: number; method?: string; note?: string | null } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { proUntil: true } });
  if (!user) return null;
  const until = extendUntil(user.proUntil, months);
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { plan: "PRO", proUntil: until } }),
    prisma.payment.create({
      data: {
        userId,
        months,
        amount: toDb(options.amount ?? 0),
        method: options.method ?? "KASPI",
        note: options.note?.slice(0, 200) ?? null,
      },
    }),
  ]);
  return updated.proUntil;
}

/**
 * Дневной грант (реферальный бонус за приглашённого друга). Бессрочному Pro продлевать нечего —
 * платёж всё равно логируется, чтобы бонус был виден в истории.
 */
export async function grantProDays(userId: string, days: number, options: { method?: string; note?: string | null } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true, proUntil: true, trialEndsAt: true } });
  if (!user) return null;
  const payment = prisma.payment.create({
    data: { userId, months: 0, days, amount: toDb(0), method: options.method ?? "REFERRAL", note: options.note?.slice(0, 200) ?? null },
  });
  const state = planState(user);
  if (state.kind === "forever") {
    await payment;
    return null;
  }
  const until = extendUntilDays(state.until, days);
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { plan: "PRO", proUntil: until } }),
    payment,
  ]);
  return updated.proUntil;
}

/** Бессрочный Pro — для близких и участников беты */
export async function grantProForever(userId: string, note: string | null = null) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { plan: "PRO", proUntil: null } }),
    prisma.payment.create({ data: { userId, months: 0, amount: toDb(0), method: "GIFT", note } }),
  ]);
}

/** Возврат на бесплатный тариф */
export async function revokePro(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { plan: "FREE", proUntil: null } });
}

/** Сводка для экрана подписки */
export async function subscriptionSummary(user: QuotaUser) {
  const state = planState(user);
  const [used, imports] = await Promise.all([
    state.pro ? Promise.resolve(0) : aiUsed(user),
    state.pro ? Promise.resolve(0) : prisma.importBatch.count({ where: { userId: user.id, status: "APPLIED" } }),
  ]);
  return {
    pro: state.pro,
    kind: state.kind,
    until: state.until ? state.until.toISOString() : null,
    daysLeft: state.daysLeft,
    aiUsed: used,
    aiLimit: FREE_LIMITS.aiPerMonth,
    importsUsed: imports,
    importsLimit: FREE_LIMITS.imports,
  };
}
