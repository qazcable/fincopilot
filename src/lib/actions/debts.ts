"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isDayKey } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";
import type { ActionResult } from "./transactions";

const debtSchema = z.object({
  id: z.string().optional(),
  person: z.string().trim().min(1, "Укажите имя").max(40, "Слишком длинное имя"),
  // OUT — я должен, IN — мне должны
  direction: z.enum(["OUT", "IN"]),
  amount: z.number().int().positive("Укажите сумму").max(MAX_AMOUNT_MINOR),
  dueOn: z.string().nullable(),
  note: z.string().trim().max(120).nullable(),
});

export type DebtFormInput = z.infer<typeof debtSchema>;

/** Долг человеку или человека мне: «занял у друга» / «дал в долг» */
export async function saveDebt(input: DebtFormInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = debtSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const { id, person, direction, amount, dueOn, note } = parsed.data;
  if (dueOn && !isDayKey(dueOn)) return { ok: false, error: "Некорректная дата" };
  const data = { person, direction, amount: toDb(amount), dueOn: dueOn || null, note: note || null };

  if (id) {
    const { count } = await prisma.debt.updateMany({ where: { id, userId: user.id }, data });
    if (count === 0) return { ok: false, error: "Долг не найден" };
  } else {
    await prisma.debt.create({ data: { ...data, userId: user.id } });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Долг закрыт: вернули или вернули мне. Повторный вызов снова открывает долг */
export async function settleDebt(id: string, settled = true): Promise<ActionResult> {
  const user = await requireUser();
  const { count } = await prisma.debt.updateMany({
    where: { id: String(id), userId: user.id },
    data: { settledAt: settled ? new Date() : null },
  });
  if (count === 0) return { ok: false, error: "Долг не найден" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteDebt(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.debt.deleteMany({ where: { id: String(id), userId: user.id } });
  revalidatePath("/", "layout");
  return { ok: true };
}
