import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getNbkRates } from "./rates";
import { kztPerUnit, type CurrencyCode } from "@/lib/domain/currency";

/** Во сколько раз суммы меняются при переходе между валютами (по курсу Нацбанка) */
export async function conversionFactor(from: CurrencyCode, to: CurrencyCode) {
  if (from === to) return 1;
  const { rates } = await getNbkRates();
  const fromRate = kztPerUnit(from, rates);
  const toRate = kztPerUnit(to, rates);
  if (!fromRate || !toRate) return null;
  return fromRate / toRate;
}

/**
 * Пересчитывает все суммы пользователя при смене основной валюты: операции, счета, кредиты,
 * график платежей, доходы, цели, лимиты и подушку. Курс — официальный, Нацбанка РК.
 */
export async function convertUserAmounts(userId: string, factor: number) {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return false;
  const k = new Prisma.Decimal(factor);
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Transaction" SET "amount" = ROUND("amount" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "Account" SET "openingBalance" = ROUND("openingBalance" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "Obligation" SET "monthlyAmount" = ROUND("monthlyAmount" * ${k})::bigint,
      "principalLeft" = ROUND("principalLeft" * ${k})::bigint, "principalTotal" = ROUND("principalTotal" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "ScheduledPayment" SET "amount" = ROUND("amount" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "RecurringIncome" SET "amount" = ROUND("amount" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "Goal" SET "targetAmount" = ROUND("targetAmount" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "Category" SET "monthlyLimit" = ROUND("monthlyLimit" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "ImportBatch" SET "closingBalance" = ROUND("closingBalance" * ${k})::bigint,
      "previousOpeningBalance" = ROUND("previousOpeningBalance" * ${k})::bigint WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "User" SET "cushion" = ROUND("cushion" * ${k})::bigint WHERE "id" = ${userId}`,
  ]);
  return true;
}
