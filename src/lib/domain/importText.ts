// Тексты импорта выписки для бота
import { formatDayKey } from "./dates";
import { formatMoney } from "./money";
import { escapeHtml } from "./text";

// Что изменил импорт вне своих операций — чтобы отмена вернула всё как было
export type ImportLink =
  | { txId: string; before: { kind: string; accountId: string; toAccountId: string | null; categoryId: string | null } }
  | { accountId: string; openingDelta: number }
  // Поступление, удалённое при связывании перевода: сохраняется целиком, чтобы восстановить
  | { restore: Record<string, string | null> };

export type ImportSummary = {
  // Старые черновики Kaspi сохранялись без банка
  bank?: string;
  bankTitle?: string;
  accountName?: string | null;
  newAccount?: boolean;
  owner?: { surname: string; name: string } | null;
  cardMask: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  closingBalance: number | null;
  total: number;
  toImport: number;
  alreadyImported: number;
  manualDuplicates: number;
  skippedOwn: number;
  // Переводы между своими картами разных банков — связываются с парными операциями
  ownTransfers?: number;
  // Переводы между картой и счётом накоплений (входят в toImport)
  transfers?: number;
  savingsAccountName?: string | null;
  income: number;
  expense: number;
  needAi: number;
  imported?: number;
  linkedTransfers?: number;
  // Пары «друг прислал — отправил дальше», перенесённые в «Транзит»
  transitPairs?: number;
  links?: ImportLink[];
  linkedKeys?: string[];
  createdAccountId?: string | null;
};

function period(summary: ImportSummary) {
  if (!summary.periodFrom || !summary.periodTo) return "";
  const from = summary.periodFrom.slice(0, 4) === summary.periodTo.slice(0, 4)
    ? formatDayKey(summary.periodFrom)
    : `${formatDayKey(summary.periodFrom)} ${summary.periodFrom.slice(0, 4)}`;
  return `${from} – ${formatDayKey(summary.periodTo)} ${summary.periodTo.slice(0, 4)}`;
}

/** Есть ли что применять: новые операции или переводы между картами */
export function hasSomethingToImport(summary: ImportSummary) {
  return summary.toImport > 0 || (summary.ownTransfers ?? 0) > 0;
}

export function formatImportDraft(summary: ImportSummary) {
  const lines = [
    `📄 <b>Выписка ${escapeHtml(summary.bankTitle ?? "Kaspi Gold")}${summary.cardMask ? ` ${summary.cardMask}` : ""}</b>`,
    period(summary),
  ];
  if (summary.accountName) {
    lines.push(summary.newAccount ? `Счёт: <b>${escapeHtml(summary.accountName)}</b> — создам` : `Счёт: ${escapeHtml(summary.accountName)}`);
  }
  lines.push("", `Операций в выписке: ${summary.total}`);
  if (summary.toImport > 0) {
    lines.push(`✅ Новых: <b>${summary.toImport}</b> — расходы ${formatMoney(summary.expense)}, поступления ${formatMoney(summary.income)}`);
  }
  if (summary.ownTransfers) {
    lines.push(`🔗 Переводы между своими картами: ${summary.ownTransfers} — свяжу с другими картами, в расходы и доходы не попадут`);
  }
  if (summary.transfers) {
    lines.push(`🔁 Переводы на «${escapeHtml(summary.savingsAccountName ?? "Накопления")}» и обратно: ${summary.transfers} — не расходы`);
  }
  if (summary.alreadyImported > 0) lines.push(`↩️ Уже импортированы раньше: ${summary.alreadyImported}`);
  if (summary.manualDuplicates > 0) lines.push(`✍️ Уже внесены вручную: ${summary.manualDuplicates}`);
  if (summary.skippedOwn > 0) lines.push(`⏭ Переводы между своими счетами пропущу: ${summary.skippedOwn}`);
  if (summary.closingBalance !== null && hasSomethingToImport(summary)) {
    lines.push("", `Баланс карты станет как в выписке: <b>${formatMoney(summary.closingBalance)}</b>`);
  }
  if (!hasSomethingToImport(summary)) lines.push("", "Новых операций нет — всё уже учтено 👌");
  return lines.join("\n");
}

export function formatImportApplied(summary: ImportSummary) {
  const lines = [
    `✅ <b>Импортировано операций: ${summary.imported ?? summary.toImport}</b>`,
    [summary.bankTitle, period(summary)].filter(Boolean).join(" · "),
  ];
  if (summary.closingBalance !== null) lines.push(`Баланс карты: ${formatMoney(summary.closingBalance)}`);
  if (summary.linkedTransfers) lines.push(`🔗 Связано переводов между своими картами: ${summary.linkedTransfers}`);
  if (summary.transitPairs) lines.push(`🔄 Транзит друзей (пришло и ушло дальше): ${summary.transitPairs} — не считаю доходом и расходом`);
  lines.push("", "Категории подобраны автоматически — поправить можно в истории. Исправленные магазины я запомню.");
  return lines.join("\n");
}
