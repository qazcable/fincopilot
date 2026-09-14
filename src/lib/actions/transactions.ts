"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { createTransaction, deleteTransaction, resolveCategoryId } from "@/lib/server/ledger";
import type { TxKind } from "@/lib/domain/constants";
import { localDateTimeToInstant } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";

export type ActionResult = { ok: true } | { ok: false; error: string };

const transactionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["EXPENSE", "INCOME"]),
  amount: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  categoryId: z.string().nullable(),
  accountId: z.string(),
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

  const [account, category] = await Promise.all([
    prisma.account.findFirst({ where: { id: data.accountId, userId: user.id } }),
    data.categoryId ? prisma.category.findFirst({ where: { id: data.categoryId, userId: user.id, kind: data.kind } }) : null,
  ]);
  if (!account) return { ok: false, error: "Счёт не найден" };

  if (data.id) {
    const existing = await prisma.transaction.findFirst({ where: { id: data.id, userId: user.id } });
    if (!existing) return { ok: false, error: "Операция не найдена" };

    // У оплаты по графику сумма и тип связаны с платежом — меняем только описание, дату, счёт и категорию
    const lockAmount = existing.scheduledPaymentId !== null;
    const kind = lockAmount ? (existing.kind as TxKind) : data.kind;
    await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        kind,
        amount: lockAmount ? existing.amount : toDb(data.amount),
        categoryId: category?.kind === kind ? category.id : await resolveCategoryId(user.id, kind, null),
        accountId: account.id,
        note: data.note?.trim() || null,
        occurredAt,
      },
    });
  } else {
    await createTransaction(user.id, {
      kind: data.kind,
      amount: data.amount,
      categoryId: category?.id ?? null,
      accountId: account.id,
      note: data.note,
      occurredAt,
      source: "APP",
    });
  }

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
