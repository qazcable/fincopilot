"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { markPaymentPaid, rebuildPendingPayments, skipPayment } from "@/lib/server/payments";
import { dayKeyOf, isDayKey, startOfDayInstant } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";
import { OBLIGATION_KINDS } from "@/lib/domain/constants";
import type { ActionResult } from "./transactions";

export async function payScheduledPayment(paymentId: string): Promise<ActionResult> {
  const user = await requireUser();
  const payment = await markPaymentPaid(user.id, String(paymentId));
  if (!payment) return { ok: false, error: "Платёж уже оплачен" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function skipScheduledPayment(paymentId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!(await skipPayment(user.id, String(paymentId)))) return { ok: false, error: "Платёж не найден" };
  revalidatePath("/", "layout");
  return { ok: true };
}

const amount = z.number().int().positive().max(MAX_AMOUNT_MINOR);

const obligationSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(Object.keys(OBLIGATION_KINDS) as [keyof typeof OBLIGATION_KINDS, ...(keyof typeof OBLIGATION_KINDS)[]]),
  title: z.string().trim().min(1, "Укажите название").max(60, "Слишком длинное название"),
  monthlyAmount: amount,
  dueDay: z.number().int().min(1).max(31),
  principalLeft: amount.nullable(),
  principalTotal: amount.nullable(),
  interestRate: z.number().min(0).max(200).nullable(),
  graceUntil: z.string().nullable(),
});

export type ObligationInput = z.infer<typeof obligationSchema>;

export async function saveObligation(input: ObligationInput): Promise<ActionResult & { id?: string }> {
  const user = await requireUser();
  const parsed = obligationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const data = parsed.data;

  const hasPrincipal = OBLIGATION_KINDS[data.kind].hasPrincipal;
  if (hasPrincipal && !data.principalLeft) return { ok: false, error: "Укажите остаток долга" };
  if (hasPrincipal && data.principalTotal && data.principalLeft && data.principalTotal < data.principalLeft) {
    return { ok: false, error: "Сумма долга не может быть меньше остатка" };
  }
  if (data.graceUntil && !isDayKey(data.graceUntil)) return { ok: false, error: "Некорректная дата" };

  const fields = {
    kind: data.kind,
    title: data.title,
    monthlyAmount: toDb(data.monthlyAmount),
    dueDay: data.dueDay,
    principalLeft: hasPrincipal ? toDb(data.principalLeft!) : null,
    principalTotal: hasPrincipal && data.principalTotal ? toDb(data.principalTotal) : null,
    interestRate: hasPrincipal ? data.interestRate : null,
    graceUntil: data.kind === "CREDIT_CARD" && data.graceUntil ? startOfDayInstant(data.graceUntil, user.timezone) : null,
    completedAt: null,
  };

  let id = data.id;
  if (id) {
    const { count } = await prisma.obligation.updateMany({ where: { id, userId: user.id }, data: fields });
    if (count === 0) return { ok: false, error: "Не найдено" };
    await rebuildPendingPayments(user, id);
  } else {
    const created = await prisma.obligation.create({
      data: { ...fields, userId: user.id, startsOn: dayKeyOf(new Date(), user.timezone) },
    });
    id = created.id;
    await rebuildPendingPayments(user, id);
  }

  revalidatePath("/", "layout");
  return { ok: true, id };
}

export async function deleteObligation(id: string): Promise<ActionResult> {
  const user = await requireUser();
  // Оплаченные операции остаются в истории (связь с платежом обнулится)
  const { count } = await prisma.obligation.deleteMany({ where: { id: String(id), userId: user.id } });
  if (count === 0) return { ok: false, error: "Не найдено" };
  revalidatePath("/", "layout");
  return { ok: true };
}
