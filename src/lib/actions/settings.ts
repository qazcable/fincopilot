"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { getAccountBalances } from "@/lib/server/ledger";
import { revokeApiKey, rotateApiKey } from "@/lib/server/api-key";
import { isValidTimeZone } from "@/lib/domain/dates";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";
import { ACCOUNT_KINDS } from "@/lib/domain/constants";
import type { ActionResult } from "./transactions";

const balance = z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR);

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

const onboardingSchema = z.object({
  balance,
  incomeDay: z.number().int().min(1).max(31).nullable(),
  incomeAmount: z.number().int().positive().max(MAX_AMOUNT_MINOR).nullable(),
});

export async function completeOnboarding(input: z.infer<typeof onboardingSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте данные" };
  const { balance: startBalance, incomeDay, incomeAmount } = parsed.data;

  await prisma.$transaction(async tx => {
    const account = await tx.account.findFirst({ where: { userId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (account) await tx.account.update({ where: { id: account.id }, data: { openingBalance: toDb(startBalance) } });
    if (incomeDay) {
      await tx.recurringIncome.create({
        data: { userId: user.id, title: "Зарплата", dayOfMonth: incomeDay, amount: incomeAmount ? toDb(incomeAmount) : null },
      });
    }
    await tx.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  });
  return done();
}

const accountSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Укажите название").max(40),
  kind: z.enum(Object.keys(ACCOUNT_KINDS) as [keyof typeof ACCOUNT_KINDS, ...(keyof typeof ACCOUNT_KINDS)[]]),
  // Текущий баланс, который видит пользователь; начальный остаток пересчитываем
  balance,
  inBudget: z.boolean(),
});

export async function saveAccount(input: z.infer<typeof accountSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const data = parsed.data;

  if (data.id) {
    const current = (await getAccountBalances(user.id)).find(a => a.id === data.id);
    if (!current) return { ok: false, error: "Счёт не найден" };
    // Корректировка баланса меняет начальный остаток, история операций остаётся нетронутой
    const openingBalance = current.openingBalance + (data.balance - current.balance);
    await prisma.account.update({
      where: { id: current.id },
      data: { name: data.name, kind: data.kind, inBudget: data.inBudget, openingBalance: toDb(openingBalance) },
    });
  } else {
    const count = await prisma.account.count({ where: { userId: user.id, archivedAt: null } });
    await prisma.account.create({
      data: { userId: user.id, name: data.name, kind: data.kind, inBudget: data.inBudget, openingBalance: toDb(data.balance), isDefault: count === 0 },
    });
  }
  return done();
}

export async function archiveAccount(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const active = await prisma.account.findMany({ where: { userId: user.id, archivedAt: null } });
  const account = active.find(a => a.id === id);
  if (!account) return { ok: false, error: "Счёт не найден" };
  if (active.length === 1) return { ok: false, error: "Нужен хотя бы один счёт" };

  await prisma.$transaction(async tx => {
    await tx.account.update({ where: { id: account.id }, data: { archivedAt: new Date(), isDefault: false } });
    if (account.isDefault) {
      const next = active.find(a => a.id !== account.id)!;
      await tx.account.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  return done();
}

export async function setDefaultAccount(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const account = await prisma.account.findFirst({ where: { id, userId: user.id, archivedAt: null } });
  if (!account) return { ok: false, error: "Счёт не найден" };
  await prisma.$transaction([
    prisma.account.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    prisma.account.update({ where: { id: account.id }, data: { isDefault: true } }),
  ]);
  return done();
}

const incomeSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Укажите название").max(40),
  dayOfMonth: z.number().int().min(1).max(31),
  amount: z.number().int().positive().max(MAX_AMOUNT_MINOR).nullable(),
});

export async function saveIncome(input: z.infer<typeof incomeSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = incomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const { id, title, dayOfMonth, amount } = parsed.data;
  const data = { title, dayOfMonth, amount: amount === null ? null : toDb(amount) };

  if (id) {
    const { count } = await prisma.recurringIncome.updateMany({ where: { id, userId: user.id }, data });
    if (count === 0) return { ok: false, error: "Не найдено" };
  } else {
    await prisma.recurringIncome.create({ data: { ...data, userId: user.id } });
  }
  return done();
}

export async function deleteIncome(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.recurringIncome.deleteMany({ where: { id: String(id), userId: user.id } });
  return done();
}

const preferencesSchema = z.object({
  cushion: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
  timezone: z.string().refine(isValidTimeZone, "Неизвестный часовой пояс"),
  remindersEnabled: z.boolean(),
});

export async function savePreferences(input: z.infer<typeof preferencesSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  await prisma.user.update({
    where: { id: user.id },
    data: { cushion: toDb(parsed.data.cushion), timezone: parsed.data.timezone, remindersEnabled: parsed.data.remindersEnabled },
  });
  return done();
}

export async function createShortcutKey(): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const key = await rotateApiKey(user.id);
  revalidatePath("/settings");
  return { ok: true, key };
}

export async function removeShortcutKey(): Promise<ActionResult> {
  const user = await requireUser();
  await revokeApiKey(user.id);
  return done();
}
