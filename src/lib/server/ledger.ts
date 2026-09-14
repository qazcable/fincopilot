import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fromDb, toDb } from "@/lib/domain/money";
import { FALLBACK_CATEGORY_KEY, type TxKind, type TxSource } from "@/lib/domain/constants";

type Db = Prisma.TransactionClient | typeof prisma;

/** Баланс = начальный остаток + доходы − расходы. Поле баланса не хранится, чтобы не расходилось с историей. */
export async function getAccountBalances(userId: string, db: Db = prisma) {
  const [accounts, sums] = await Promise.all([
    db.account.findMany({ where: { userId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    db.transaction.groupBy({ by: ["accountId", "kind"], where: { userId }, _sum: { amount: true } }),
  ]);

  return accounts.map(account => {
    const income = fromDb(sums.find(s => s.accountId === account.id && s.kind === "INCOME")?._sum.amount);
    const expense = fromDb(sums.find(s => s.accountId === account.id && s.kind === "EXPENSE")?._sum.amount);
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      inBudget: account.inBudget,
      isDefault: account.isDefault,
      openingBalance: fromDb(account.openingBalance),
      balance: fromDb(account.openingBalance) + income - expense,
    };
  });
}

export async function getDefaultAccount(userId: string, db: Db = prisma) {
  const account = await db.account.findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!account) throw new Error("No account");
  return account;
}

export async function resolveCategoryId(userId: string, kind: TxKind, categoryKey: string | null, db: Db = prisma) {
  const keys = categoryKey ? [categoryKey, FALLBACK_CATEGORY_KEY[kind]] : [FALLBACK_CATEGORY_KEY[kind]];
  const categories = await db.category.findMany({ where: { userId, kind, key: { in: keys }, archivedAt: null } });
  return (categories.find(c => c.key === categoryKey) ?? categories[0])?.id ?? null;
}

export type NewTransaction = {
  kind: TxKind;
  amount: number;
  note?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  occurredAt?: Date;
  source: TxSource;
  rawInput?: string | null;
  scheduledPaymentId?: string | null;
};

export async function createTransaction(userId: string, input: NewTransaction, db: Db = prisma) {
  const account = input.accountId
    ? await db.account.findFirst({ where: { id: input.accountId, userId } })
    : await getDefaultAccount(userId, db);
  if (!account) throw new Error("Account not found");

  let categoryId = input.categoryId ?? null;
  if (categoryId) {
    const category = await db.category.findFirst({ where: { id: categoryId, userId, kind: input.kind } });
    if (!category) categoryId = null;
  }
  if (!categoryId) categoryId = await resolveCategoryId(userId, input.kind, null, db);

  return db.transaction.create({
    data: {
      userId,
      accountId: account.id,
      categoryId,
      kind: input.kind,
      amount: toDb(input.amount),
      note: input.note?.trim().slice(0, 200) || null,
      occurredAt: input.occurredAt ?? new Date(),
      source: input.source,
      rawInput: input.rawInput?.slice(0, 500) ?? null,
      scheduledPaymentId: input.scheduledPaymentId ?? null,
    },
    include: { category: true },
  });
}

/** Удаление операции. Если это была оплата по графику — платёж снова ожидается, а долг возвращается. */
export async function deleteTransaction(userId: string, transactionId: string) {
  return prisma.$transaction(async tx => {
    const transaction = await tx.transaction.findFirst({
      where: { id: transactionId, userId },
      include: { scheduledPayment: { include: { obligation: true } } },
    });
    if (!transaction) return null;

    const payment = transaction.scheduledPayment;
    await tx.transaction.delete({ where: { id: transaction.id } });

    if (payment) {
      await tx.scheduledPayment.update({ where: { id: payment.id }, data: { status: "PENDING", paidAt: null } });
      if (payment.obligation.principalLeft !== null) {
        await tx.obligation.update({
          where: { id: payment.obligationId },
          data: { principalLeft: { increment: payment.amount }, completedAt: null },
        });
      }
    }
    return transaction;
  });
}
