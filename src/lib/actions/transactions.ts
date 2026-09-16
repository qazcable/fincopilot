"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { createTransaction, createTransfer, deleteTransaction, resolveCategoryId } from "@/lib/server/ledger";
import { notifyCategoryLimit, notifyGoalsReached } from "@/lib/server/bot";
import { rememberMerchantCategory } from "@/lib/server/imports";
import type { TxKind } from "@/lib/domain/constants";
import { localDateTimeToInstant } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";

export type ActionResult = { ok: true } | { ok: false; error: string };

const transactionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  amount: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  categoryId: z.string().nullable(),
  accountId: z.string(),
  // Счёт назначения — только для перевода
  toAccountId: z.string().nullable().optional(),
  note: z.string().max(200).optional(),
  localDateTime: z.string(),
});

export type TransactionInput = z.infer<typeof transactionSchema>;

export async function saveTransaction(input: TransactionInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте сумму и поля" };
  const data = parsed.data;

  const occurredAt = localDateTimeToInstant(data.localDateTime, user.timezone);
  if (!occurredAt) return { ok: false, error: "Некорректная дата" };

  if (data.kind === "TRANSFER") return saveTransfer(user.id, { ...data, occurredAt });

  const [account, category] = await Promise.all([
    prisma.account.findFirst({ where: { id: data.accountId, userId: user.id } }),
    data.categoryId ? prisma.category.findFirst({ where: { id: data.categoryId, userId: user.id, kind: data.kind } }) : null,
  ]);
  if (!account) return { ok: false, error: "Счёт не найден" };

  let savedCategoryId: string | null = null;
  if (data.id) {
    const existing = await prisma.transaction.findFirst({ where: { id: data.id, userId: user.id } });
    if (!existing) return { ok: false, error: "Операция не найдена" };
    const kind = existing.scheduledPaymentId !== null ? (existing.kind as TxKind) : data.kind;

    // У оплаты по графику сумма и тип связаны с платежом — меняем только описание, дату, счёт и категорию
    const lockAmount = existing.scheduledPaymentId !== null;
    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        kind,
        toAccountId: null,
        amount: lockAmount ? existing.amount : toDb(data.amount),
        categoryId: category?.kind === kind ? category.id : await resolveCategoryId(user.id, kind, null),
        accountId: account.id,
        note: data.note?.trim() || null,
        occurredAt,
      },
    });
    savedCategoryId = updated.kind === "EXPENSE" ? updated.categoryId : null;
    // Исправленная категория операции из выписки запоминается для этого магазина
    if (existing.categoryId !== updated.categoryId) await rememberMerchantCategory(user.id, updated.id, updated.categoryId);
  } else {
    const created = await createTransaction(user.id, {
      kind: data.kind,
      amount: data.amount,
      categoryId: category?.id ?? null,
      accountId: account.id,
      note: data.note,
      occurredAt,
      source: "APP",
    });
    savedCategoryId = created.kind === "EXPENSE" ? created.categoryId : null;
  }

  // Предупреждение о лимите категории уходит в бот после ответа, не задерживая интерфейс
  if (savedCategoryId) after(() => notifyCategoryLimit(user, savedCategoryId, occurredAt));
  // Баланс счёта накоплений мог дотянуть цель
  after(() => notifyGoalsReached(user.id));

  revalidatePath("/", "layout");
  return { ok: true };
}

async function saveTransfer(userId: string, data: TransactionInput & { occurredAt: Date }): Promise<ActionResult> {
  if (!data.toAccountId) return { ok: false, error: "Выберите, куда перевести" };
  if (data.toAccountId === data.accountId) return { ok: false, error: "Выберите разные счета" };
  const accounts = await prisma.account.count({ where: { userId, id: { in: [data.accountId, data.toAccountId] } } });
  if (accounts !== 2) return { ok: false, error: "Счёт не найден" };

  if (data.id) {
    const existing = await prisma.transaction.findFirst({ where: { id: data.id, userId } });
    if (!existing) return { ok: false, error: "Операция не найдена" };
    if (existing.scheduledPaymentId !== null) return { ok: false, error: "Оплату по графику нельзя сделать переводом" };
    await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        kind: "TRANSFER",
        amount: toDb(data.amount),
        categoryId: null,
        accountId: data.accountId,
        toAccountId: data.toAccountId,
        note: data.note?.trim() || null,
        occurredAt: data.occurredAt,
      },
    });
  } else {
    await createTransfer(userId, {
      fromAccountId: data.accountId,
      toAccountId: data.toAccountId,
      amount: data.amount,
      note: data.note,
      occurredAt: data.occurredAt,
      source: "APP",
    });
  }
  // Перевод на счёт накоплений — главный способ дойти до цели
  after(() => notifyGoalsReached(userId));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeTransaction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const deleted = await deleteTransaction(user.id, String(id));
  if (!deleted) return { ok: false, error: "Операция не найдена" };
  revalidatePath("/", "layout");
  return { ok: true };
}
