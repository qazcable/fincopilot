import "server-only";
import { prisma } from "./prisma";
import { rebuildPendingPayments } from "./payments";
import { dayKeyOf } from "@/lib/domain/dates";
import { toDb } from "@/lib/domain/money";

type LoanUser = { id: string; timezone: string };

export const KASPI_LOANS_TITLE = "Kaspi кредиты";

/** Общее обязательство по кредитам Kaspi: одно на пользователя, находится по названию */
async function findKaspiLoans(userId: string) {
  return prisma.obligation.findFirst({
    where: { userId, completedAt: null, OR: [{ title: KASPI_LOANS_TITLE }, { kind: "LOAN", title: { contains: "Kaspi", mode: "insensitive" } }] },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Создаёт или обновляет «Kaspi кредиты»: ежемесячный платёж и день из выписки по кредитам,
 * остаток долга — со скриншота (если передан). Возвращает, создано ли новое обязательство.
 */
export async function upsertKaspiLoans(user: LoanUser, data: { monthly?: number; dueDay?: number; remaining?: number }) {
  const existing = await findKaspiLoans(user.id);
  const fields = {
    ...(data.monthly ? { monthlyAmount: toDb(data.monthly) } : {}),
    ...(data.dueDay ? { dueDay: data.dueDay } : {}),
    ...(data.remaining !== undefined ? { principalLeft: toDb(data.remaining) } : {}),
  };

  let id: string;
  let created = false;
  if (existing) {
    const principalTotal = data.remaining !== undefined && (existing.principalTotal === null || existing.principalTotal < toDb(data.remaining))
      ? { principalTotal: toDb(data.remaining) }
      : {};
    await prisma.obligation.update({ where: { id: existing.id }, data: { ...fields, ...principalTotal } });
    id = existing.id;
  } else {
    if (!data.monthly || !data.dueDay) return null;
    const obligation = await prisma.obligation.create({
      data: {
        userId: user.id,
        title: KASPI_LOANS_TITLE,
        kind: "LOAN",
        monthlyAmount: toDb(data.monthly),
        dueDay: data.dueDay,
        principalLeft: data.remaining !== undefined ? toDb(data.remaining) : null,
        principalTotal: data.remaining !== undefined ? toDb(data.remaining) : null,
        startsOn: dayKeyOf(new Date(), user.timezone),
      },
    });
    id = obligation.id;
    created = true;
  }
  await rebuildPendingPayments(user, id);
  return { id, created };
}
