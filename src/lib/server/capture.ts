import "server-only";
import { prisma } from "./prisma";
import { createTransaction, resolveCategoryId } from "./ledger";
import { markPaymentPaid } from "./payments";
import { categorizeMerchants, isAiConfigured, parseWithAi } from "./ai";
import { normalizeMerchant } from "@/lib/domain/kaspi";
import { rateLimit } from "./rate-limit";
import { matchCategoryKey, quickParse } from "@/lib/domain/parse";
import { accountForCard, parseBankSms, parseWalletAmount } from "@/lib/domain/autocapture";
import { addDays, dayKeyOf } from "@/lib/domain/dates";
import { fromDb } from "@/lib/domain/money";
import { DEBT_CATEGORY_KEY, type TxSource } from "@/lib/domain/constants";

// Не больше 20 обращений к ИИ в минуту на пользователя
const AI_LIMIT = { count: 20, windowMs: 60_000 };

type CaptureUser = { id: string; timezone: string };

export type CaptureResult =
  | { ok: true; transactionId: string; linkedPaymentTitle: string | null }
  | { ok: false; reason: "not_understood" | "ai_unavailable" | "rate_limited" };

type Parsed = { amount: number; kind: "EXPENSE" | "INCOME"; categoryId: string | null; note: string };

async function aiCategories(userId: string) {
  return prisma.category.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, name: true, kind: true },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Если трата похожа на платёж по графику (категория «Кредиты и счета», та же сумма, ±10 дней) —
 * отмечаем платёж оплаченным, чтобы резерв не учитывал его дважды.
 */
async function tryLinkPayment(user: CaptureUser, parsed: Parsed, source: TxSource, rawInput: string) {
  if (parsed.kind !== "EXPENSE" || !parsed.categoryId) return null;
  const category = await prisma.category.findUnique({ where: { id: parsed.categoryId } });
  if (category?.key !== DEBT_CATEGORY_KEY) return null;

  const today = dayKeyOf(new Date(), user.timezone);
  const candidates = await prisma.scheduledPayment.findMany({
    where: { userId: user.id, status: "PENDING", dueOn: { gte: addDays(today, -10), lte: addDays(today, 10) } },
    include: { obligation: true },
    orderBy: { dueOn: "asc" },
  });
  const match = candidates.find(p => fromDb(p.amount) === parsed.amount);
  if (!match) return null;

  await markPaymentPaid(user.id, match.id);
  const transaction = await prisma.transaction.update({
    where: { scheduledPaymentId: match.id },
    data: { source, rawInput: rawInput.slice(0, 500) },
  });
  return { transactionId: transaction.id, title: match.obligation.title };
}

async function save(user: CaptureUser, parsed: Parsed, source: TxSource, rawInput: string): Promise<CaptureResult> {
  const linked = await tryLinkPayment(user, parsed, source, rawInput);
  if (linked) return { ok: true, transactionId: linked.transactionId, linkedPaymentTitle: linked.title };

  const transaction = await createTransaction(user.id, { ...parsed, source, rawInput });
  return { ok: true, transactionId: transaction.id, linkedPaymentTitle: null };
}

/** Категория, которую пользователь уже выбирал для такого описания (правка в боте или приложении) */
async function learnedCategoryId(userId: string, kind: "EXPENSE" | "INCOME", note: string) {
  if (kind !== "EXPENSE" || !note) return null;
  const learned = await prisma.merchantCategory.findUnique({
    where: { userId_merchant: { userId, merchant: normalizeMerchant(note) } },
    include: { category: true },
  });
  return learned?.category.kind === kind && !learned.category.archivedAt ? learned.categoryId : null;
}

/**
 * Сумма понятна, а категория по словарю — нет: спрашиваем у ИИ только категорию (короткий дешёвый запрос).
 * Ответ запоминается, чтобы следующая такая запись обошлась без ИИ.
 */
async function aiCategoryId(userId: string, kind: "EXPENSE" | "INCOME", note: string) {
  if (!note || !isAiConfigured() || !rateLimit(`ai:${userId}`, AI_LIMIT.count, AI_LIMIT.windowMs)) return null;
  const categories = (await aiCategories(userId)).filter(c => c.kind === kind);
  try {
    const categoryId = (await categorizeMerchants([note], categories, 1)).get(0) ?? null;
    const category = categories.find(c => c.id === categoryId);
    if (!category) return null;
    if (kind === "EXPENSE") {
      await prisma.merchantCategory.upsert({
        where: { userId_merchant: { userId, merchant: normalizeMerchant(note) } },
        create: { userId, merchant: normalizeMerchant(note), categoryId: category.id },
        update: {},
      });
    }
    return category.id;
  } catch (error) {
    console.error("AI category failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Выученная категория → словарь → ИИ → «Другое» */
async function categorize(userId: string, kind: "EXPENSE" | "INCOME", note: string, dictionaryKey = matchCategoryKey(note, kind)) {
  return (
    await learnedCategoryId(userId, kind, note) ??
    (dictionaryKey ? await resolveCategoryId(userId, kind, dictionaryKey) : await aiCategoryId(userId, kind, note)) ??
    await resolveCategoryId(userId, kind, null)
  );
}

export type AutoCaptureResult = CaptureResult | { ok: false; reason: "duplicate" | "foreign_currency" | "bad_amount"; transactionId?: string };

// Автоматизация iOS иногда срабатывает дважды — одинаковую операцию в течение пары минут не записываем
const REPEAT_WINDOW_MS = 3 * 60 * 1000;

async function saveAuto(user: CaptureUser, input: { amount: number; kind: "EXPENSE" | "INCOME"; note: string; accountId: string | null }, source: TxSource, rawInput: string): Promise<AutoCaptureResult> {
  const recent = await prisma.transaction.findFirst({
    where: {
      userId: user.id, source, kind: input.kind, amount: BigInt(input.amount), note: input.note,
      createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
    },
  });
  if (recent) return { ok: false, reason: "duplicate", transactionId: recent.id };

  const categoryId = await categorize(user.id, input.kind, input.note);
  const linked = await tryLinkPayment(user, { ...input, categoryId }, source, rawInput);
  if (linked) return { ok: true, transactionId: linked.transactionId, linkedPaymentTitle: linked.title };
  const transaction = await createTransaction(user.id, { ...input, categoryId, source, rawInput });
  return { ok: true, transactionId: transaction.id, linkedPaymentTitle: null };
}

async function accounts(userId: string) {
  return prisma.account.findMany({ where: { userId, archivedAt: null }, select: { id: true, name: true, isDefault: true, kind: true } });
}

/** Оплата через Apple Wallet: сумма, магазин и название карты из автоматизации «Транзакция» */
export async function captureWallet(user: CaptureUser, data: { amount: string; merchant?: string; card?: string }): Promise<AutoCaptureResult> {
  const parsed = parseWalletAmount(data.amount);
  if (!parsed) return { ok: false, reason: "bad_amount" };
  // Покупки в валюте точнее придут из выписки — там сумма в тенге после конвертации
  if (parsed.currency !== "KZT") return { ok: false, reason: "foreign_currency" };
  const note = (data.merchant ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Оплата картой";
  const account = data.card ? accountForCard(data.card, await accounts(user.id)) : null;
  return saveAuto(user, { amount: parsed.amount, kind: "EXPENSE", note, accountId: account?.id ?? null }, "WALLET", `Apple Wallet: ${data.card ?? ""} ${data.amount}`.trim());
}

/** SMS банка, пересланное автоматизацией «Сообщение» */
export async function captureSms(user: CaptureUser, text: string): Promise<AutoCaptureResult> {
  const parsed = parseBankSms(text.slice(0, 1000));
  if (!parsed) return captureText(user, text, "SMS");
  const list = await accounts(user.id);
  const account = parsed.cardDigits ? list.find(a => a.name.includes(parsed.cardDigits!)) : null;
  return saveAuto(user, { amount: parsed.amount, kind: parsed.kind, note: parsed.note, accountId: account?.id ?? null }, "SMS", text.slice(0, 500));
}

export async function captureText(user: CaptureUser, text: string, source: TxSource): Promise<CaptureResult> {
  const input = text.trim().slice(0, 500);
  if (!input) return { ok: false, reason: "not_understood" };

  const quick = quickParse(input);
  if (quick) {
    const categoryId = await categorize(user.id, quick.kind, quick.note, quick.categoryKey);
    return save(user, { amount: quick.amount, kind: quick.kind, categoryId, note: quick.note }, source, input);
  }

  if (!isAiConfigured()) return { ok: false, reason: "ai_unavailable" };
  if (!rateLimit(`ai:${user.id}`, AI_LIMIT.count, AI_LIMIT.windowMs)) return { ok: false, reason: "rate_limited" };
  const parsed = await parseWithAi({ text: input }, await aiCategories(user.id));
  if (!parsed) return { ok: false, reason: "not_understood" };
  return save(user, { ...parsed, categoryId: await learnedCategoryId(user.id, parsed.kind, parsed.note) ?? parsed.categoryId }, source, input);
}

export async function captureAudio(user: CaptureUser, audio: Buffer, mimeType: string, source: TxSource): Promise<CaptureResult> {
  if (!isAiConfigured()) return { ok: false, reason: "ai_unavailable" };
  if (!rateLimit(`ai:${user.id}`, AI_LIMIT.count, AI_LIMIT.windowMs)) return { ok: false, reason: "rate_limited" };
  const parsed = await parseWithAi({ audio, mimeType }, await aiCategories(user.id));
  if (!parsed) return { ok: false, reason: "not_understood" };
  return save(user, { ...parsed, categoryId: await learnedCategoryId(user.id, parsed.kind, parsed.note) ?? parsed.categoryId }, source, "🎙 голосовое сообщение");
}
