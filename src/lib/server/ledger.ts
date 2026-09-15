import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fromDb, toDb } from "@/lib/domain/money";
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY_KEY, type TxKind, type TxSource } from "@/lib/domain/constants";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Баланс = начальный остаток + доходы − расходы − переводы со счёта + переводы на счёт.
 * Поле баланса не хранится, чтобы не расходилось с историей.
 */
export async function getAccountBalances(userId: string, db: Db = prisma) {
  const [accounts, sums, incoming] = await Promise.all([
    db.account.findMany({ where: { userId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    db.transaction.groupBy({ by: ["accountId", "kind"], where: { userId }, _sum: { amount: true } }),
    db.transaction.groupBy({ by: ["toAccountId"], where: { userId, kind: "TRANSFER" }, _sum: { amount: true } }),
  ]);

  return accounts.map(account => {
    const sum = (kind: string) => fromDb(sums.find(s => s.accountId === account.id && s.kind === kind)?._sum.amount);
    const transfersIn = fromDb(incoming.find(s => s.toAccountId === account.id)?._sum.amount);
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      inBudget: account.inBudget,
      isDefault: account.isDefault,
      openingBalance: fromDb(account.openingBalance),
      balance: fromDb(account.openingBalance) + sum("INCOME") - sum("EXPENSE") - sum("TRANSFER") + transfersIn,
    };
  });
}

/** Движение по счёту (без начального остатка) за операции до момента `until` */
export async function accountMovementUntil(db: Db, accountId: string, until: Date) {
  const [sums, incoming] = await Promise.all([
    db.transaction.groupBy({ by: ["kind"], where: { accountId, occurredAt: { lt: until } }, _sum: { amount: true } }),
    db.transaction.aggregate({ where: { toAccountId: accountId, kind: "TRANSFER", occurredAt: { lt: until } }, _sum: { amount: true } }),
  ]);
  const sum = (kind: string) => fromDb(sums.find(s => s.kind === kind)?._sum.amount);
  return sum("INCOME") - sum("EXPENSE") - sum("TRANSFER") + fromDb(incoming._sum.amount);
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
  let categories = await db.category.findMany({ where: { userId, kind, key: { in: keys }, archivedAt: null } });
  // Новая стандартная категория (например, «Табак») у давних пользователей появляется при первом использовании
  const missing = categoryKey && !categories.some(c => c.key === categoryKey)
    ? DEFAULT_CATEGORIES.find(c => c.key === categoryKey && c.kind === kind)
    : undefined;
  if (missing) {
    const exists = await db.category.findFirst({ where: { userId, key: missing.key } });
    if (!exists) {
      const index = DEFAULT_CATEGORIES.indexOf(missing);
      await db.category.create({ data: { userId, key: missing.key, name: missing.name, kind: missing.kind, emoji: missing.emoji, color: missing.color, sortOrder: index } });
      categories = await db.category.findMany({ where: { userId, kind, key: { in: keys }, archivedAt: null } });
    }
  }
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

export type NewTransfer = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  note?: string | null;
  occurredAt?: Date;
  source: TxSource;
};

/** Перевод между своими счетами: не расход и не доход, в статистику и лимиты не попадает */
export async function createTransfer(userId: string, input: NewTransfer, db: Db = prisma) {
  if (input.fromAccountId === input.toAccountId) throw new Error("Same account");
  const accounts = await db.account.findMany({ where: { userId, id: { in: [input.fromAccountId, input.toAccountId] } } });
  if (accounts.length !== 2) throw new Error("Account not found");
  return db.transaction.create({
    data: {
      userId,
      kind: "TRANSFER",
      accountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: toDb(input.amount),
      note: input.note?.trim().slice(0, 200) || null,
      occurredAt: input.occurredAt ?? new Date(),
      source: input.source,
    },
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
