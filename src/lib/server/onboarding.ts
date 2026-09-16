import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getAccountBalances } from "./ledger";
import { startTrial } from "./plan";
import { awardReferralBonus } from "./access";
import { MAX_AMOUNT_MINOR, toDb } from "@/lib/domain/money";
import { isCurrencyCode } from "@/lib/domain/currency";
import { REFERRAL_BONUS_DAYS } from "@/lib/domain/plan";

export const onboardingSchema = z.object({
  balance: z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR),
  incomeDay: z.number().int().min(1).max(31).nullable(),
  incomeAmount: z.number().int().positive().max(MAX_AMOUNT_MINOR).nullable(),
  currency: z.string().optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export type OnboardingResult =
  | { ok: true; firstTime: boolean; trialStarted: boolean }
  | { ok: false; error: string };

/**
 * Первая настройка — одна и та же для приложения и для диалога в боте.
 * Повторный вызов (двойное нажатие, настройка сразу в двух местах) ничего не меняет.
 */
export async function finishOnboarding(userId: string, input: OnboardingInput): Promise<OnboardingResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте данные" };
  const { balance: startBalance, incomeDay, incomeAmount, currency } = parsed.data;

  const firstTime = await prisma.$transaction(async tx => {
    // Для тенге по умолчанию показываем и доллары; для других валют — второй валютой тенге
    const currencyData = isCurrencyCode(currency) ? { currency, secondaryCurrency: currency === "KZT" ? "USD" : "KZT" } : {};
    const { count } = await tx.user.updateMany({
      where: { id: userId, onboardedAt: null },
      data: { onboardedAt: new Date(), botOnboardingStep: null, botOnboardingData: Prisma.DbNull, ...currencyData },
    });
    if (count === 0) return false;

    const current = (await getAccountBalances(userId, tx)).find(a => a.isDefault);
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
        data: { userId, title: "Зарплата", dayOfMonth: incomeDay, amount: incomeAmount ? toDb(incomeAmount) : null },
      });
    }
    return true;
  });

  // Первые две недели — полный Pro, чтобы человек увидел все возможности
  const trialStarted = firstTime ? await startTrial(userId) : false;
  return { ok: true, firstTime, trialStarted };
}

/** Бонус пригласившему — только когда приглашённый действительно настроил профиль */
export async function rewardInviter(userId: string) {
  const reward = await awardReferralBonus(userId);
  if (!reward) return;
  // Бот подключается лениво: он сам импортирует этот модуль
  const { notifyReferralReward } = await import("./bot");
  await notifyReferralReward(reward.referrerTelegramId, REFERRAL_BONUS_DAYS);
}
