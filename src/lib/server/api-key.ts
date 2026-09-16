import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hasAccess } from "./access-rules";

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** Новый ключ для Apple Shortcuts. Старый перестаёт работать. В БД хранится только хеш. */
export async function rotateApiKey(userId: string) {
  const key = `fc_${randomBytes(24).toString("base64url")}`;
  await prisma.user.update({
    where: { id: userId },
    data: { apiKeyHash: hashKey(key), apiKeyHint: key.slice(-4) },
  });
  return key;
}

export async function revokeApiKey(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { apiKeyHash: null, apiKeyHint: null } });
}

export async function findUserByApiKey(authorization: string | null) {
  // Команда из iCloud-ссылки подставляет ключ как есть, без «Bearer» — принимаем оба вида
  const key = authorization?.trim().match(/^(?:Bearer\s+)?(fc_[\w-]{20,})$/)?.[1];
  if (!key) return null;
  const user = await prisma.user.findUnique({ where: { apiKeyHash: hashKey(key) } });
  // Ключ человека, у которого закрыли доступ, больше не работает
  return user && hasAccess(user) ? user : null;
}
