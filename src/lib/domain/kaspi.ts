// Разбор PDF-выписки Kaspi Gold. Чистые функции над текстовыми фрагментами с координатами
// (извлечение фрагментов из PDF — в src/lib/server/pdf.ts).
import { makeKey, type DayKey } from "./dates";
import { matchCategoryKey } from "./parse";
import type { TxKind } from "./constants";

export type TextItem = { x: number; y: number; text: string };

export type KaspiRow = {
  date: DayKey;
  // тиыны со знаком: минус — списание
  amount: number;
  operation: string;
  details: string;
  foreign: string | null;
};

export type KaspiStatement = {
  cardMask: string | null;
  periodFrom: DayKey | null;
  periodTo: DayKey | null;
  openingBalance: number | null;
  closingBalance: number | null;
  rows: KaspiRow[];
};

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2})$/;
const MONEY_RE = /^([+-])\s*([\d\s ]+),(\d{2})\s*₸$/;
const FOREIGN_RE = /^\([+-]\s*[\d\s ]+,\d{2}\s+[A-Z]{3}\)$/;

// Границы столбцов таблицы операций (в пунктах PDF)
const DATE_MAX_X = 90;
const DETAILS_MIN_X = 300;
const ROW_TOLERANCE = 2.5;
// Перенос строки внутри операции — не дальше этой высоты от строки с датой
const WRAP_MAX_GAP = 18;

function parseMoney(text: string): number | null {
  const m = text.trim().match(MONEY_RE);
  if (!m) return null;
  const value = Number(m[2].replace(/[\s ]/g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -value : value;
}

function parseShortDate(text: string): DayKey | null {
  const m = text.match(DATE_RE);
  return m ? makeKey(2000 + Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** Группирует фрагменты страницы в строки по вертикали (сверху вниз) */
export function toLines(items: TextItem[]) {
  const lines: { y: number; cells: TextItem[] }[] = [];
  for (const item of items) {
    if (!item.text.trim()) continue;
    const line = lines.find(l => Math.abs(l.y - item.y) <= ROW_TOLERANCE);
    if (line) line.cells.push(item);
    else lines.push({ y: item.y, cells: [item] });
  }
  for (const line of lines) line.cells.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

export function isKaspiStatement(pages: TextItem[][]) {
  const text = pages.slice(0, 3).flat().map(i => i.text).join(" ");
  return /Kaspi/i.test(text) && /ВЫПИСКА/.test(text) && /Дата/.test(text) && /Операция/.test(text);
}

export function parseKaspiStatement(pages: TextItem[][]): KaspiStatement {
  const statement: KaspiStatement = { cardMask: null, periodFrom: null, periodTo: null, openingBalance: null, closingBalance: null, rows: [] };

  for (const items of pages) {
    const lines = toLines(items);
    let current: { row: KaspiRow; y: number } | null = null;

    for (const line of lines) {
      const joined = line.cells.map(c => c.text.trim()).join(" ");

      const period = joined.match(/за период с (\d{2}\.\d{2}\.\d{2}) по (\d{2}\.\d{2}\.\d{2})/);
      if (period && !statement.periodFrom) {
        statement.periodFrom = parseShortDate(period[1]);
        statement.periodTo = parseShortDate(period[2]);
      }
      const card = joined.match(/Номер карты:\s*(\*\d{4})/);
      if (card) statement.cardMask = card[1];

      // «Доступно на ДД.ММ.ГГ  + 44 503,68 ₸» — в сводке: первое — начальный, второе — конечный остаток
      const available = joined.match(/^Доступно на (\d{2}\.\d{2}\.\d{2}):?\s+([+-]\s*[\d\s ]+,\d{2}\s*₸)/);
      if (available) {
        const date = parseShortDate(available[1]);
        const value = parseMoney(available[2]);
        if (date && value !== null) {
          if (date === statement.periodFrom) statement.openingBalance = value;
          if (date === statement.periodTo) statement.closingBalance = value;
        }
      }

      const first = line.cells[0];
      const date = first.x < DATE_MAX_X ? parseShortDate(first.text.trim()) : null;

      if (date) {
        const rest = line.cells.slice(1);
        const amountCell = rest.find(c => c.x < DETAILS_MIN_X && parseMoney(c.text) !== null);
        if (!amountCell) {
          current = null;
          continue;
        }
        const operation = rest.filter(c => c !== amountCell && c.x < DETAILS_MIN_X).map(c => c.text.trim()).join(" ");
        const details = rest.filter(c => c.x >= DETAILS_MIN_X).map(c => c.text.trim()).join(" ");
        const row: KaspiRow = { date, amount: parseMoney(amountCell.text)!, operation, details, foreign: null };
        statement.rows.push(row);
        current = { row, y: line.y };
        continue;
      }

      // Продолжение предыдущей операции: перенос названия операции, деталей или сумма в валюте
      if (current && current.y - line.y <= WRAP_MAX_GAP && first.x >= DATE_MAX_X) {
        for (const cell of line.cells) {
          const text = cell.text.trim();
          if (FOREIGN_RE.test(text)) current.row.foreign = text.slice(1, -1);
          else if (cell.x >= DETAILS_MIN_X) current.row.details = `${current.row.details} ${text}`.trim();
          else current.row.operation = `${current.row.operation} ${text}`.trim();
        }
        current.y = line.y;
      } else {
        current = null;
      }
    }
  }
  return statement;
}

// ── Смысл операций для учёта ─────────────────────────────

export type KaspiDecision =
  | { action: "import"; kind: TxKind; categoryKey: string | null; note: string; needsAi: boolean }
  // Перевод между своими счетами: out — со счёта выписки, in — на него. Импортируется, если есть счёт накоплений
  | { action: "transfer"; direction: "out" | "in"; note: string }
  | { action: "skip"; reason: "own_transfer" };

function cleanDetails(details: string) {
  const text = details.replace(/\s+/g, " ").trim();
  return text.length > 1 ? text : "Без описания";
}

/** Как операция выписки отражается в учёте: тип, категория и нужно ли спрашивать ИИ */
export function classifyKaspiRow(row: KaspiRow): KaspiDecision {
  const op = row.operation.toLowerCase();
  const details = cleanDetails(row.details);
  const income = row.amount > 0;

  // Движения между своими счетами Kaspi не расход и не доход
  if (op.includes("свой счет") || op.includes("свой счёт") || op.includes("своего счета") || op.includes("своего счёта")) {
    if (/кредит/i.test(details)) {
      return { action: "import", kind: "EXPENSE", categoryKey: "debts", note: details, needsAi: false };
    }
    if (/депозит/i.test(details)) {
      return { action: "transfer", direction: income ? "in" : "out", note: details };
    }
    return { action: "skip", reason: "own_transfer" };
  }

  if (op.startsWith("покупка")) {
    if (income) return { action: "import", kind: "INCOME", categoryKey: "gift_in", note: `Возврат: ${details}`, needsAi: false };
    const key = matchCategoryKey(details, "EXPENSE");
    return { action: "import", kind: "EXPENSE", categoryKey: key, note: details, needsAi: key === null };
  }
  if (op.startsWith("снятие")) {
    return { action: "import", kind: "EXPENSE", categoryKey: "cash", note: details, needsAi: false };
  }
  if (op.startsWith("перевод")) {
    return income
      ? { action: "import", kind: "INCOME", categoryKey: "gift_in", note: details, needsAi: false }
      : { action: "import", kind: "EXPENSE", categoryKey: "transfers", note: details, needsAi: false };
  }
  if (op.startsWith("пополнение")) {
    const categoryKey = /терминал|банкомат/i.test(details) ? "other_in" : matchCategoryKey(details, "INCOME") ?? "gift_in";
    return { action: "import", kind: "INCOME", categoryKey, note: details, needsAi: false };
  }
  if (op.startsWith("зачисление")) {
    return { action: "import", kind: "INCOME", categoryKey: "other_in", note: details, needsAi: false };
  }
  // «Разное»: комиссии, обслуживание
  return income
    ? { action: "import", kind: "INCOME", categoryKey: "other_in", note: details, needsAi: false }
    : { action: "import", kind: "EXPENSE", categoryKey: "other", note: details, needsAi: false };
}

/**
 * Стабильный ключ строки для защиты от повторного импорта.
 * Одинаковые операции в один день различаются порядковым номером.
 */
export function importKeys(rows: KaspiRow[], prefix = "kaspi") {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const base = `${row.date}|${row.amount}|${row.operation}|${row.details}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${prefix}:${base}|${n}`;
  });
}

export function normalizeMerchant(details: string) {
  return details.toLowerCase().replace(/\s+/g, " ").replace(/["«»]/g, "").trim();
}

export type ExistingTx = { id: string; kind: string; amount: number; day: DayKey };
export type Candidate = { kind: TxKind; amount: number; day: DayKey };

/**
 * Сопоставление с операциями, внесёнными вручную: тот же тип и сумма, дата ±1 день.
 * Каждая существующая операция закрывает не больше одной строки выписки.
 * Возвращает индексы кандидатов-дублей.
 */
export function findManualDuplicates(candidates: Candidate[], existing: ExistingTx[], dayDiff: (a: DayKey, b: DayKey) => number) {
  const used = new Set<string>();
  const duplicates = new Set<number>();
  candidates.forEach((candidate, index) => {
    const match = existing
      .filter(tx => !used.has(tx.id) && tx.kind === candidate.kind && tx.amount === candidate.amount && Math.abs(dayDiff(tx.day, candidate.day)) <= 1)
      .sort((a, b) => Math.abs(dayDiff(a.day, candidate.day)) - Math.abs(dayDiff(b.day, candidate.day)))[0];
    if (match) {
      used.add(match.id);
      duplicates.add(index);
    }
  });
  return duplicates;
}
