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
import { isCurrencyCode } from "@/lib/domain/currency";
import { conversionFactor, convertUserAmounts } from "@/lib/server/currency-convert";
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
  currency: z.string().optional(),
});

export async function completeOnboarding(input: z.infer<typeof onboardingSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте данные" };
  const { balance: startBalance, incomeDay, incomeAmount, currency } = parsed.data;

  await prisma.$transaction(async tx => {
    const current = (await getAccountBalances(user.id, tx)).find(a => a.isDefault);
    if (current) {
      const hasHistory = current.balance !== current.openingBalance;
      // Введённый баланс — текущий: учитываем уже внесённые операции (например, из выписки).
      // Пропуск шага (0) при уже сверенной истории баланс не трогает.
      if (startBalance !== 0 || !hasHistory) {
        await tx.account.update({
          where: { id: current.id },
          data: { openingBalance: toDb(current.openingBalance + startBalance - current.balance) },
        });
      }
    }
    if (incomeDay) {
      await tx.recurringIncome.create({
        data: { userId: user.id, title: "Зарплата", dayOfMonth: incomeDay, amount: incomeAmount ? toDb(incomeAmount) : null },
      });
    }
    // Для тенге по умолчанию показываем и доллары; для других валют — без второй валюты
    const currencyData = isCurrencyCode(currency) ? { currency, secondaryCurrency: currency === "KZT" ? "USD" : "KZT" } : {};
    await tx.user.update({ where: { id: user.id }, data: { onboardedAt: new Date(), ...currencyData } });
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
  morningDigest: z.boolean(),
  eveningDigest: z.boolean(),
  weeklyDigest: z.boolean(),
});

export async function savePreferences(input: z.infer<typeof preferencesSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const { cushion, ...flags } = parsed.data;
  await prisma.user.update({ where: { id: user.id }, data: { ...flags, cushion: toDb(cushion) } });
  return done();
}

/** Основная валюта учёта и валюта для пересчёта. Суммы не конвертируются — меняются только подписи */
export async function saveCurrency(input: { currency: string; secondary: string | null; convert?: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const currency = String(input?.currency);
  const secondary = input?.secondary == null ? null : String(input.secondary);
  if (!isCurrencyCode(currency) || (secondary !== null && !isCurrencyCode(secondary))) return { ok: false, error: "Неизвестная валюта" };

  // Пересчёт уже внесённых сумм по курсу Нацбанка — по желанию пользователя
  if (input?.convert && isCurrencyCode(user.currency) && user.currency !== currency) {
    const factor = await conversionFactor(user.currency, currency);
    if (factor === null) return { ok: false, error: "Нет курса Нацбанка для этой пары валют — попробуйте позже" };
    await convertUserAmounts(user.id, factor);
  }
  await prisma.user.update({ where: { id: user.id }, data: { currency, secondaryCurrency: secondary === currency ? null : secondary } });
  return done();
}

const limitsSchema = z.array(z.object({
  categoryId: z.string(),
  limit: z.number().int().positive().max(MAX_AMOUNT_MINOR).nullable(),
})).max(100);

/** Лимиты расходов по категориям на месяц; null — снять лимит */
export async function saveCategoryLimits(input: z.infer<typeof limitsSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте суммы лимитов" };

  const categories = await prisma.category.findMany({
    where: { userId: user.id, kind: "EXPENSE", id: { in: parsed.data.map(item => item.categoryId) } },
    select: { id: true },
  });
  const allowed = new Set(categories.map(c => c.id));

  await prisma.$transaction(
    parsed.data
      .filter(item => allowed.has(item.categoryId))
      .map(item => prisma.category.update({
        where: { id: item.categoryId },
        data: { monthlyLimit: item.limit === null ? null : toDb(item.limit) },
      }))
  );
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
