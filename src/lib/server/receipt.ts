import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { formatDayKey, pluralDays } from "@/lib/domain/dates";

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

  const amount = formatMoney(fromDb(tx.amount) * (tx.kind === "EXPENSE" ? -1 : 1), { sign: true });
  const category = tx.category ? `${tx.category.emoji} ${tx.category.name}` : "Без категории";
  const lines = [
    `<b>${amount}</b> · ${escapeHtml(category)}`,
    tx.note ? escapeHtml(tx.note) : null,
    linkedPaymentTitle ? `✅ Платёж «${escapeHtml(linkedPaymentTitle)}» отмечен оплаченным` : null,
    "",
    await budgetLine(user),
  ].filter(line => line !== null);

  const html = lines.join("\n");
  const plain = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return { html, plain, transaction: tx };
}
