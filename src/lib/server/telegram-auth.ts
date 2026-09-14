import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

const MAX_AGE_SECONDS = 24 * 60 * 60;

/** Проверка подписи initData по алгоритму Telegram Mini Apps */
export function validateInitData(initData: string, now = Date.now()): TelegramUser | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const received = Buffer.from(hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") || "") as TelegramUser;
    return typeof user?.id === "number" ? user : null;
  } catch {
    return null;
  }
}

/** Если задан ALLOWED_TELEGRAM_IDS — пускаем только этих пользователей */
export function isTelegramUserAllowed(telegramId: number | bigint) {
  const allowed = process.env.ALLOWED_TELEGRAM_IDS?.split(",").map(s => s.trim()).filter(Boolean);
  return !allowed?.length || allowed.includes(String(telegramId));
}
