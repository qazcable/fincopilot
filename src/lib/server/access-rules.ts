import "server-only";

function ownerIds() {
  return process.env.ALLOWED_TELEGRAM_IDS?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
}

/** Владельцы проекта (ALLOWED_TELEGRAM_IDS): входят без приглашения, могут приглашать и видят отзывы */
export function isOwner(telegramId: number | bigint) {
  const owners = ownerIds();
  // Без списка владельцев (локальная разработка) доступ открыт всем
  return owners.length === 0 || owners.includes(String(telegramId));
}

export function ownerTelegramIds() {
  return ownerIds();
}

/** Есть ли у пользователя доступ: владелец или вошёл по приглашению */
export function hasAccess(user: { telegramId: bigint; accessGrantedAt: Date | null }) {
  return isOwner(user.telegramId) || user.accessGrantedAt !== null;
}
