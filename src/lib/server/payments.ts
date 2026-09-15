import "server-only";
import { prisma } from "./prisma";
import { createTransaction, resolveCategoryId } from "./ledger";
import { addDays, dayKeyOf } from "@/lib/domain/dates";
import { fromDb, toDb } from "@/lib/domain/money";
import { planPayments } from "@/lib/domain/schedule";
import { DEBT_CATEGORY_KEY } from "@/lib/domain/constants";

export const SCHEDULE_HORIZON_DAYS = 62;

/** Досоздаёт платежи по всем активным обязательствам на ~2 месяца вперёд. Идемпотентно. */
export async function ensureSchedule(user: { id: string; timezone: string }) {
  const horizon = addDays(dayKeyOf(new Date(), user.timezone), SCHEDULE_HORIZON_DAYS);
  const obligations = await prisma.obligation.findMany({
    where: { userId: user.id, completedAt: null },
    include: { payments: { select: { dueOn: true, amount: true, status: true } } },
  });

  const rows = obligations.flatMap(obligation =>
    planPayments(
      {
        monthlyAmount: fromDb(obligation.monthlyAmount),
        dueDay: obligation.dueDay,
        startsOn: obligation.startsOn,
        principalLeft: obligation.principalLeft === null ? null : fromDb(obligation.principalLeft),
      },
      obligation.payments.map(p => ({ dueOn: p.dueOn, amount: fromDb(p.amount), status: p.status })),
      horizon
    ).map(p => ({ userId: user.id, obligationId: obligation.id, dueOn: p.dueOn, amount: toDb(p.amount) }))
  );

  // Уникальный ключ (obligationId, dueOn) защищает от дублей при параллельных запросах
  if (rows.length > 0) await prisma.scheduledPayment.createMany({ data: rows, skipDuplicates: true });
}

/** Отметить платёж оплаченным: операция расхода + уменьшение долга */
export async function markPaymentPaid(userId: string, paymentId: string, accountId?: string | null) {
  return prisma.$transaction(async tx => {
    const payment = await tx.scheduledPayment.findFirst({
      where: { id: paymentId, userId, status: "PENDING" },
      include: { obligation: true },
    });
    if (!payment) return null;

    const categoryId = await resolveCategoryId(userId, "EXPENSE", DEBT_CATEGORY_KEY, tx);
    await createTransaction(userId, {
      kind: "EXPENSE",
      amount: fromDb(payment.amount),
      note: payment.obligation.title,
      categoryId,
      accountId,
      source: "PAYMENT",
      scheduledPaymentId: payment.id,
    }, tx);

    await tx.scheduledPayment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date() } });

    if (payment.obligation.principalLeft !== null) {
      const left = fromDb(payment.obligation.principalLeft) - fromDb(payment.amount);
      await tx.obligation.update({
        where: { id: payment.obligationId },
        data: { principalLeft: toDb(Math.max(0, left)), completedAt: left <= 0 ? new Date() : null },
      });
    }
    return payment;
  });
}

export async function skipPayment(userId: string, paymentId: string) {
  const { count } = await prisma.scheduledPayment.updateMany({
    where: { id: paymentId, userId, status: "PENDING" },
    data: { status: "SKIPPED" },
  });
  return count > 0;
}

/** Пересобрать будущие неоплаченные платежи после изменения обязательства */
export async function rebuildPendingPayments(user: { id: string; timezone: string }, obligationId: string) {
  const today = dayKeyOf(new Date(), user.timezone);
  await prisma.scheduledPayment.deleteMany({
    where: { obligationId, userId: user.id, status: "PENDING", dueOn: { gte: today } },
  });
  await ensureSchedule(user);
}
