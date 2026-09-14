import "server-only";
import { cache } from "react";
import { prisma } from "./prisma";
import { readSession } from "./session";
import type { TelegramUser } from "./telegram-auth";
import { DEFAULT_CATEGORIES } from "@/lib/domain/constants";

export type AppUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export const getCurrentUser = cache(async () => {
  const userId = await readSession();
  if (userId) return prisma.user.findUnique({ where: { id: userId } });

  // Локальная разработка в обычном браузере, без Telegram
  const devTelegramId = process.env.DEV_TELEGRAM_ID;
  if (process.env.NODE_ENV !== "production" && devTelegramId) {
    return upsertTelegramUser({ id: Number(devTelegramId), first_name: "Dev" }, { keepName: true });
  }
  return null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/** Находит пользователя по Telegram или создаёт со стандартными категориями и счётом */
export async function upsertTelegramUser(tgUser: TelegramUser, options: { keepName?: boolean } = {}) {
  const telegramId = BigInt(tgUser.id);
  const existing = await prisma.user.findUnique({ where: { telegramId } });

  if (existing) {
    if (options.keepName) return existing;
    return prisma.user.update({
      where: { id: existing.id },
      data: { username: tgUser.username ?? null, firstName: tgUser.first_name ?? existing.firstName },
    });
  }

  return prisma.user.create({
    data: {
      telegramId,
      username: tgUser.username,
      firstName: tgUser.first_name,
      accounts: { create: { name: "Основная карта", kind: "CARD", isDefault: true } },
      categories: {
        create: DEFAULT_CATEGORIES.map((c, index) => ({
          key: c.key, name: c.name, kind: c.kind, emoji: c.emoji, color: c.color, sortOrder: index,
        })),
      },
    },
  });
}
