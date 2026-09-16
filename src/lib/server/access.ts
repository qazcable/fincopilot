import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { upsertTelegramUser } from "./auth";
import type { TelegramUser } from "./telegram-auth";
import { hasAccess, isOwner } from "./access-rules";
import { grantProDays, startTrial } from "./plan";
import { REFERRAL_BONUS_DAYS } from "@/lib/domain/plan";

// Приглашение действует 30 дней
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export { hasAccess, isOwner, ownerTelegramIds } from "./access-rules";

export async function hasAccessByTelegramId(telegramId: number | bigint) {
  if (isOwner(telegramId)) return true;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { accessGrantedAt: true } });
  return Boolean(user?.accessGrantedAt);
}

export async function createInvite(ownerId: string, note: string | null) {
  const code = randomBytes(8).toString("base64url");
  return prisma.invite.create({ data: { code, createdById: ownerId, note: note?.trim().slice(0, 60) || null } });
}

export function inviteLink(code: string) {
  const bot = process.env.NEXT_PUBLIC_BOT_USERNAME;
  return bot ? `https://t.me/${bot}?start=inv_${code}` : null;
}

/** Сколько приглашений уже создал пользователь — для лимита на злоупотребление */
export async function inviteCount(userId: string) {
  return prisma.invite.count({ where: { createdById: userId } });
}

/** Пригласил ли пользователь хоть раз — для чек-листа первых шагов */
export async function hasInvited(userId: string) {
  return (await inviteCount(userId)) > 0;
}

export type RedeemResult =
  | { ok: true; user: Awaited<ReturnType<typeof upsertTelegramUser>>; isNew: boolean; inviterTelegramId: bigint | null }
  | { ok: false; reason: "invalid" | "used" | "expired" };

/** Вход по приглашению: создаёт пользователя, выдаёт доступ и закрывает приглашение */
export async function redeemInvite(code: string, tgUser: TelegramUser): Promise<RedeemResult> {
  const invite = await prisma.invite.findUnique({ where: { code }, include: { createdBy: { select: { telegramId: true } } } });
  if (!invite || invite.revokedAt) return { ok: false, reason: "invalid" };

  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(tgUser.id) } });
  // Уже есть доступ — приглашение не тратим
  if (existing && hasAccess(existing)) return { ok: true, user: existing, isNew: false, inviterTelegramId: null };
  if (invite.usedById) return { ok: false, reason: "used" };
  if (Date.now() - invite.createdAt.getTime() > INVITE_TTL_MS) return { ok: false, reason: "expired" };

  const user = await upsertTelegramUser(tgUser);
  // Условное обновление: одно приглашение — один человек, даже при двойном нажатии
  const { count } = await prisma.invite.updateMany({ where: { id: invite.id, usedById: null }, data: { usedById: user.id, usedAt: new Date() } });
  if (count === 0) return { ok: false, reason: "used" };
  const granted = await prisma.user.update({ where: { id: user.id }, data: { accessGrantedAt: new Date(), invitedById: invite.createdById } });
  // Новичок сразу получает Pro на пробу — иначе не увидит, за что платить
  await startTrial(granted.id);
  return { ok: true, user: granted, isNew: !existing, inviterTelegramId: invite.createdBy.telegramId };
}

export async function listInvites(userId: string) {
  const invites = await prisma.invite.findMany({
    where: { createdById: userId, revokedAt: null },
    include: { usedBy: { select: { firstName: true, username: true, onboardedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return invites.map(i => ({
    id: i.id,
    note: i.note,
    link: inviteLink(i.code),
    createdAt: i.createdAt.toISOString(),
    expired: !i.usedById && Date.now() - i.createdAt.getTime() > INVITE_TTL_MS,
    usedBy: i.usedBy ? { name: i.usedBy.firstName ?? i.usedBy.username ?? "Без имени", username: i.usedBy.username, onboarded: i.usedBy.onboardedAt !== null } : null,
    usedAt: i.usedAt?.toISOString() ?? null,
    rewarded: i.rewardedAt !== null,
  }));
}

/** Отзыв приглашения: владелец может отозвать любое, остальные — только своё */
export async function revokeInvite(actor: { id: string; telegramId: bigint }, inviteId: string) {
  const where = isOwner(actor.telegramId)
    ? { id: inviteId, revokedAt: null }
    : { id: inviteId, createdById: actor.id, revokedAt: null };
  const invite = await prisma.invite.findFirst({ where });
  if (!invite) return false;
  await prisma.$transaction([
    prisma.invite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } }),
    ...(invite.usedById ? [prisma.user.update({ where: { id: invite.usedById }, data: { accessGrantedAt: null } })] : []),
  ]);
  return true;
}

/**
 * Начисляет бонус пригласившему, когда приглашённый закончил настройку профиля —
 * не за регистрацию, иначе можно было бы просто зайти по чужой ссылке без пользы для продукта.
 */
export async function awardReferralBonus(newUserId: string) {
  const invite = await prisma.invite.findFirst({
    where: { usedById: newUserId, rewardedAt: null, revokedAt: null },
    include: { createdBy: { select: { id: true, telegramId: true } } },
  });
  if (!invite) return null;
  // Условное обновление: даже если онбординг завершится дважды подряд, бонус начислится один раз
  const { count } = await prisma.invite.updateMany({ where: { id: invite.id, rewardedAt: null }, data: { rewardedAt: new Date() } });
  if (count === 0) return null;
  await grantProDays(invite.createdById, REFERRAL_BONUS_DAYS, { method: "REFERRAL", note: "Бонус за приглашённого друга" });
  return { referrerTelegramId: invite.createdBy.telegramId };
}
