"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isDayKey } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";
import type { ActionResult } from "./transactions";

const goalSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Укажите название").max(60, "Слишком длинное название"),
  emoji: z.string().trim().min(1).max(16),
  targetAmount: z.number().int().positive("Укажите сумму").max(MAX_AMOUNT_MINOR),
  targetDate: z.string().nullable(),
  // Существующий счёт накоплений или новый
  accountId: z.string().nullable(),
  newAccount: z.object({
    name: z.string().trim().min(1, "Укажите название счёта").max(40),
    balance: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
  }).nullable(),
});

export type GoalFormInput = z.infer<typeof goalSchema>;

export async function saveGoal(input: GoalFormInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const data = parsed.data;
  if (data.targetDate && !isDayKey(data.targetDate)) return { ok: false, error: "Некорректная дата" };

  try {
    await persistGoal(user.id, data);
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message };
    throw error;
  }

  // Цель могла оказаться уже достигнутой (например, сумму уменьшили)
  after(async () => (await import("@/lib/server/bot")).notifyGoalsReached(user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

class UserError extends Error {}

function persistGoal(userId: string, data: GoalFormInput) {
  const user = { id: userId };
  return prisma.$transaction(async tx => {
    let accountId = data.accountId;
    if (!accountId || data.newAccount) {
      if (!data.newAccount) throw new UserError("Выберите счёт накоплений");
      // Накопления не входят в лимит на день — это деньги, которые не тратятся
      const account = await tx.account.create({
        data: { userId: user.id, name: data.newAccount.name, kind: "SAVINGS", inBudget: false, openingBalance: toDb(data.newAccount.balance) },
      });
      accountId = account.id;
    } else if (!(await tx.account.findFirst({ where: { id: accountId, userId: user.id, archivedAt: null } }))) {
      throw new UserError("Счёт не найден");
    }

    const fields = {
      title: data.title,
      emoji: data.emoji,
      targetAmount: toDb(data.targetAmount),
      targetDate: data.targetDate,
      accountId,
    };
    if (data.id) {
      const { count } = await tx.goal.updateMany({ where: { id: data.id, userId: user.id }, data: fields });
      if (count === 0) throw new UserError("Цель не найдена");
    } else {
      const last = await tx.goal.aggregate({ where: { userId: user.id }, _max: { sortOrder: true } });
      await tx.goal.create({ data: { ...fields, userId: user.id, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    }
  });
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const user = await requireUser();
  // Удаляется только цель; счёт и деньги на нём остаются
  const { count } = await prisma.goal.deleteMany({ where: { id: String(id), userId: user.id } });
  if (count === 0) return { ok: false, error: "Цель не найдена" };
  revalidatePath("/", "layout");
  return { ok: true };
}
