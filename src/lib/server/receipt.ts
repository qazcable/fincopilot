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

/** Текст чека (HTML) и простой текст для Apple Shortcuts */
export async function buildReceipt(user: ReceiptUser, transactionId: string, linkedPaymentTitle: string | null = null) {
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
    "",
    await budgetLine(user),
  ].filter(line => line !== null);

  const html = lines.join("\n");
  return { html, plain: stripHtml(html), transaction: tx };
}
