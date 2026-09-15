import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { evaluateCategoryLimit } from "./limits";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { formatDayKey, pluralDays } from "@/lib/domain/dates";
import { formatLimitAlert, formatLimitReceiptLine } from "@/lib/domain/digest";
import { escapeHtml, stripHtml } from "@/lib/domain/text";

export { escapeHtml };

type ReceiptUser = { id: string; timezone: string; cushion: bigint };

export async function budgetLine(user: ReceiptUser) {
  const snapshot = await getBudgetSnapshot(user);
  const { budget } = snapshot;
  if (budget.status === "over") {
    return `⚠️ До ${formatDayKey(snapshot.horizon)} не хватает <b>${formatMoney(Math.abs(Math.min(budget.free, budget.leftToday)))}</b>`;
  }
  return `Можно сегодня: <b>${formatMoney(Math.max(0, budget.leftToday))}</b> · ${pluralDays(budget.daysLeft)} до ${formatDayKey(snapshot.horizon)}`;
}

/**
 * Сводка для нескольких операций из одного сообщения: список с категориями, предупреждения лимитов и один раз — лимит на день.
 * Кнопки правки категории и отмены — у отдельных чеков каждой операции.
 */
export async function buildMultiReceipt(user: ReceiptUser, transactionIds: string[]) {
  const transactions = await prisma.transaction.findMany({
    where: { id: { in: transactionIds }, userId: user.id },
    include: { category: true },
  });
  const ordered = transactionIds.map(id => transactions.find(t => t.id === id)).filter(t => t !== undefined);
  const expense = ordered.filter(t => t.kind === "EXPENSE").reduce((sum, t) => sum + fromDb(t.amount), 0);
  const income = ordered.filter(t => t.kind === "INCOME").reduce((sum, t) => sum + fromDb(t.amount), 0);
  const lines = [
    `✅ <b>Записал операций: ${ordered.length}</b>`,
    // Номера совпадают с кнопками под сообщением
    ...ordered.map((t, index) => {
      const amount = formatMoney(fromDb(t.amount) * (t.kind === "EXPENSE" ? -1 : 1), { sign: true });
      const category = t.category ? `${t.category.emoji} ${t.category.name}` : "Без категории";
      return `${index + 1}. <b>${amount}</b> · ${escapeHtml(category)}${t.note ? ` — ${escapeHtml(t.note)}` : ""}`;
    }),
    [expense > 0 ? `Расходы: <b>${formatMoney(expense)}</b>` : null, income > 0 ? `Поступления: <b>${formatMoney(income)}</b>` : null].filter(Boolean).join(" · "),
    "",
    await budgetLine(user),
  ];
  const html = lines.join("\n");
  return { html, plain: stripHtml(html), transactions: ordered };
}

/**
 * Операции, записанные из того же сообщения, что и `transactionId`: одинаковый исходный текст и время записи.
 * Нужны, чтобы после правки одной строки заново собрать общее сообщение со списком.
 */
export async function siblingTransactionIds(userId: string, tx: { rawInput: string | null; createdAt: Date; source: string }) {
  if (!tx.rawInput) return [];
  const siblings = await prisma.transaction.findMany({
    where: {
      userId,
      source: tx.source,
      rawInput: tx.rawInput,
      createdAt: { gte: new Date(tx.createdAt.getTime() - 60_000), lte: new Date(tx.createdAt.getTime() + 60_000) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return siblings.map(s => s.id);
}

/** Текст чека (HTML) и простой текст для Apple Shortcuts */
export async function buildReceipt(user: ReceiptUser, transactionId: string, linkedPaymentTitle: string | null = null, options: { budget?: boolean } = {}) {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId: user.id },
    include: { category: true, account: true },
  });
  if (!tx) return null;

  // Порог лимита, достигнутый этой тратой, показываем прямо в чеке — отдельное сообщение не нужно
  const limit = tx.kind === "EXPENSE" ? await evaluateCategoryLimit(user, tx.categoryId, tx.occurredAt) : null;
  const limitText = limit ? (limit.newLevel ? formatLimitAlert(limit.line, limit.newLevel) : formatLimitReceiptLine(limit.line)) : null;

  const amount = formatMoney(fromDb(tx.amount) * (tx.kind === "EXPENSE" ? -1 : 1), { sign: true });
  const category = tx.category ? `${tx.category.emoji} ${tx.category.name}` : "Без категории";
  const lines = [
    `<b>${amount}</b> · ${escapeHtml(category)}`,
    tx.note ? escapeHtml(tx.note) : null,
    linkedPaymentTitle ? `✅ Платёж «${escapeHtml(linkedPaymentTitle)}» отмечен оплаченным` : null,
    limitText,
    // В пачке операций лимит на день показывается один раз — в сводке
    ...(options.budget === false ? [] : ["", await budgetLine(user)]),
  ].filter(line => line !== null);

  const html = lines.join("\n");
  return { html, plain: stripHtml(html), transaction: tx };
}
