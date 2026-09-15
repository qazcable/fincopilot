// Тексты импорта выписки для бота
import { formatDayKey } from "./dates";
import { formatMoney } from "./money";
import { escapeHtml } from "./text";

export type ImportSummary = {
  cardMask: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  closingBalance: number | null;
  total: number;
  toImport: number;
  alreadyImported: number;
  manualDuplicates: number;
  skippedOwn: number;
  // Переводы между картой и счётом накоплений (входят в toImport)
  transfers?: number;
  savingsAccountName?: string | null;
  income: number;
  expense: number;
  needAi: number;
  imported?: number;
};

function period(summary: ImportSummary) {
  if (!summary.periodFrom || !summary.periodTo) return "";
  const from = summary.periodFrom.slice(0, 4) === summary.periodTo.slice(0, 4)
    ? formatDayKey(summary.periodFrom)
    : `${formatDayKey(summary.periodFrom)} ${summary.periodFrom.slice(0, 4)}`;
  return `${from} – ${formatDayKey(summary.periodTo)} ${summary.periodTo.slice(0, 4)}`;
}

export function formatImportDraft(summary: ImportSummary) {
  const lines = [
    `📄 <b>Выписка Kaspi Gold${summary.cardMask ? ` ${summary.cardMask}` : ""}</b>`,
    period(summary),
    "",
    `Операций в выписке: ${summary.total}`,
  ];
  if (summary.toImport > 0) {
    lines.push(`✅ Новых: <b>${summary.toImport}</b> — расходы ${formatMoney(summary.expense)}, поступления ${formatMoney(summary.income)}`);
  }
  if (summary.alreadyImported > 0) lines.push(`↩️ Уже импортированы раньше: ${summary.alreadyImported}`);
  if (summary.manualDuplicates > 0) lines.push(`✍️ Уже внесены вручную: ${summary.manualDuplicates}`);
  if (summary.transfers) {
    lines.push(`🔁 Переводы на «${escapeHtml(summary.savingsAccountName ?? "Накопления")}» и обратно: ${summary.transfers} — не расходы`);
  }
  if (summary.skippedOwn > 0) lines.push(`⏭ Переводы между своими счетами пропущу: ${summary.skippedOwn}`);
  if (summary.closingBalance !== null && summary.toImport > 0) {
    lines.push("", `Баланс карты станет как в выписке: <b>${formatMoney(summary.closingBalance)}</b>`);
  }
  if (summary.toImport === 0) lines.push("", "Новых операций нет — всё уже учтено 👌");
  return lines.join("\n");
}

export function formatImportApplied(summary: ImportSummary) {
  const lines = [
    `✅ <b>Импортировано операций: ${summary.imported ?? summary.toImport}</b>`,
    period(summary),
  ];
  if (summary.closingBalance !== null) lines.push(`Баланс карты: ${formatMoney(summary.closingBalance)}`);
  lines.push("", "Категории подобраны автоматически — поправить можно в истории. Исправленные магазины я запомню.");
  return lines.join("\n");
}
