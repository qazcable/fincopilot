// Выписки банков Казахстана: определение банка, разбор таблицы операций и смысл операций для учёта.
// Kaspi Gold разбирается в kaspi.ts, здесь — Банк ЦентрКредит, Freedom и Alatau City Bank.
import { makeKey, type DayKey } from "./dates";
import { matchCategoryKey } from "./parse";
import {
  classifyKaspiRow, importKeys, isKaspiStatement, parseKaspiStatement, toLines,
  type KaspiDecision, type KaspiRow, type KaspiStatement, type TextItem,
} from "./kaspi";

export type BankCode = "KASPI_GOLD" | "BCC" | "FREEDOM" | "ALATAU";

export const BANKS: Record<BankCode, { title: string; short: string; nameHints: RegExp }> = {
  KASPI_GOLD: { title: "Kaspi Gold", short: "Kaspi", nameHints: /kaspi|каспи/i },
  BCC: { title: "Банк ЦентрКредит", short: "БЦК", nameHints: /центркредит|bcc|бцк/i },
  FREEDOM: { title: "Freedom Bank", short: "Freedom", nameHints: /freedom|фридом/i },
  ALATAU: { title: "Alatau City Bank", short: "Alatau", nameHints: /alatau|алатау/i },
};

export type ParsedStatement = KaspiStatement & {
  bank: BankCode;
  // Фамилия и имя владельца — чтобы узнавать переводы между своими счетами
  owner: { surname: string; name: string } | null;
};

export type StatementDecision =
  | KaspiDecision
  // Перевод между своими счетами в разных банках: связывается с парной операцией другого счёта, иначе пропускается
  | { action: "own"; direction: "out" | "in"; note: string };

type Line = ReturnType<typeof toLines>[number];

const joinLine = (line: Line) => line.cells.map(c => c.text.trim()).join(" ").replace(/\s+/g, " ").trim();

/** «-2 000.00 KZT», «+21,000.00 ₸», «375 000», «-100 000.0» + «0 KZT» — в тиыны */
export function parseBankNumber(raw: string, decimalComma = false): number | null {
  let text = raw.replace(/KZT|USD|EUR|RUB|₸|\$/g, "").replace(/[\s  ]/g, "");
  if (decimalComma) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

const fullDate = (text: string): DayKey | null => {
  const iso = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return makeKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const ru = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return ru ? makeKey(Number(ru[3]), Number(ru[2]), Number(ru[1])) : null;
};

function periodOf(text: string) {
  const m = text.match(/(\d{2}\.\d{2}\.\d{4})\s*(?:-|–|по)\s*(\d{2}\.\d{2}\.\d{4})/);
  return m ? { from: fullDate(m[1]), to: fullDate(m[2]) } : null;
}

function ownerFrom(fullName: string | undefined): ParsedStatement["owner"] {
  const parts = fullName?.trim().split(/\s+/).filter(p => /^[А-ЯЁа-яёA-Za-z-]+$/.test(p));
  if (!parts || parts.length < 2) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return { surname: cap(parts[0]), name: cap(parts[1]) };
}

const emptyStatement = (bank: BankCode): ParsedStatement => ({
  bank, owner: null, cardMask: null, periodFrom: null, periodTo: null, openingBalance: null, closingBalance: null, rows: [],
});

// ── Банк ЦентрКредит ─────────────────────────────────────

// Столбцы таблицы операций (пункты PDF)
const BCC = { descFrom: 155, origFrom: 250, kztFrom: 315, feeFrom: 372, cashbackFrom: 436, cashbackTo: 487 };

const BCC_OPERATIONS = ["Пополнение от", "Перевод от", "Покупка", "Перевод", "Пополнение", "Снятие", "Оплата", "Возврат", "Погашение", "Комиссия", "Кешбэк", "Зачисление"];

function parseBcc(pages: TextItem[][]): ParsedStatement {
  const statement = emptyStatement("BCC");
  type Block = { date: DayKey; pending: boolean; desc: string[]; orig: string[]; kzt: string[]; fee: string[]; y: number };
  const blocks: Block[] = [];
  let current: Block | null = null;
  let balanceHeaderSeen = false;

  pages.forEach((items, pageIndex) => {
    const lines = toLines(items);
    let rowOnPage = false;
    lines.forEach((line, index) => {
      const text = joinLine(line);
      if (pageIndex === 0) {
        const period = text.match(/^Период выписки/) ? periodOf(text) : null;
        if (period) { statement.periodFrom = period.from; statement.periodTo = period.to; }
        const card = text.match(/Номер платежной\s+\d+\**(\d{4})/);
        if (card) statement.cardMask = `*${card[1]}`;
        if (/^ИИН:/.test(text) && index > 0) statement.owner = ownerFrom(joinLine(lines[index - 1]));
        if (/^Остаток на дату/.test(text)) balanceHeaderSeen = true;
        else if (balanceHeaderSeen && statement.closingBalance === null && /\d/.test(text) && line.cells.some(c => c.x < 150 && /\d/.test(c.text))) {
          statement.openingBalance = parseBankNumber(line.cells.filter(c => c.x < 150).map(c => c.text).join(""));
          statement.closingBalance = parseBankNumber(line.cells.filter(c => c.x >= 480).map(c => c.text).join(""));
        }
      }

      const [first, second] = line.cells;
      const date = first && first.x < 80 ? fullDate(first.text) : null;
      if (date && second && second.x < BCC.descFrom && (fullDate(second.text) || /ожидается/i.test(second.text))) {
        current = { date, pending: /ожидается/i.test(second.text), desc: [], orig: [], kzt: [], fee: [], y: line.y };
        blocks.push(current);
        rowOnPage = true;
        line.cells.slice(2).forEach(cell => addBccCell(current!, cell));
        return;
      }
      // Продолжение операции: на той же странице (перенос строк) или в начале следующей
      const continues = current && line.cells.every(c => c.x >= BCC.descFrom) &&
        (rowOnPage ? current.y - line.y <= 16 : line.y > 700);
      if (continues) {
        line.cells.forEach(cell => addBccCell(current!, cell));
        current!.y = line.y;
      } else if (rowOnPage) {
        current = null;
      }
    });
  });

  for (const block of blocks) {
    if (block.pending) continue;
    const kzt = parseBankNumber(block.kzt.join("")) ?? 0;
    const fee = parseBankNumber(block.fee.join("")) ?? 0;
    const amount = kzt + fee;
    if (amount === 0) continue;
    const description = block.desc.join(" ").replace(/\s+/g, " ").trim();
    const operation = BCC_OPERATIONS.find(op => description.toLowerCase().startsWith(op.toLowerCase())) ?? description.split(" ")[0] ?? "";
    const details = description.slice(operation.length).trim();
    const orig = block.orig.join(" ").replace(/\s+/g, " ").trim();
    statement.rows.push({
      date: block.date,
      amount,
      operation,
      details: details || operation,
      foreign: /USD|EUR|RUB/.test(orig) ? orig : null,
    });
  }
  return statement;
}

function addBccCell(block: { desc: string[]; orig: string[]; kzt: string[]; fee: string[] }, cell: TextItem) {
  const text = cell.text.trim();
  if (!text) return;
  if (cell.x < BCC.origFrom) block.desc.push(text);
  else if (cell.x < BCC.kztFrom) block.orig.push(text);
  else if (cell.x < BCC.feeFrom) block.kzt.push(text);
  else if (cell.x < BCC.cashbackFrom) block.fee.push(text);
}

// ── Freedom Bank ─────────────────────────────────────────

const FREEDOM = { amountFrom: 150, currencyFrom: 265, operationFrom: 300, detailsFrom: 380 };

function parseFreedom(pages: TextItem[][]): ParsedStatement {
  const statement = emptyStatement("FREEDOM");

  pages.forEach((items, pageIndex) => {
    const lines = toLines(items);
    if (pageIndex === 0) {
      lines.forEach((line, index) => {
        const text = joinLine(line);
        const period = /за период/.test(text) ? periodOf(text) : null;
        if (period) {
          statement.periodFrom = period.from;
          statement.periodTo = period.to;
          statement.owner = ownerFrom(lines[index + 1] && joinLine(lines[index + 1]));
        }
        const card = text.match(/Номер карты:\s*\**(\d{4})/);
        if (card) statement.cardMask = `*${card[1]}`;
        // Строка счёта в тенге: «KZ… KZT 0.00 ₸»
        if (/KZ\w+\s+KZT/.test(text) && statement.closingBalance === null) {
          statement.closingBalance = parseBankNumber(line.cells.filter(c => /\d/.test(c.text) && c.x > 480).map(c => c.text).join(""));
        }
      });
    }

    const header = lines.find(line => line.cells.some(c => c.text.trim() === "Детали"));
    if (!header) return;
    const tableLines = lines.filter(line => line.y < header.y && line.y > 70);

    const rows = tableLines
      .map(line => {
        const date = line.cells[0] && line.cells[0].x < FREEDOM.amountFrom ? fullDate(line.cells[0].text) : null;
        const amountCell = line.cells.find(c => c.x >= FREEDOM.amountFrom && c.x < FREEDOM.currencyFrom);
        const amount = amountCell ? parseBankNumber(amountCell.text) : null;
        if (!date || amount === null) return null;
        return {
          y: line.y,
          date,
          amount,
          currency: line.cells.filter(c => c.x >= FREEDOM.currencyFrom && c.x < FREEDOM.operationFrom).map(c => c.text.trim()).join(""),
          operation: line.cells.filter(c => c.x >= FREEDOM.operationFrom && c.x < FREEDOM.detailsFrom).map(c => c.text.trim()).join(" "),
          details: [] as string[],
        };
      })
      .filter(row => row !== null);

    // Детали идут абзацем, отцентрованным по строке операции: абзац → операция, чья строка внутри абзаца (или ближайшая)
    const detailLines = tableLines
      .map(line => ({ y: line.y, text: line.cells.filter(c => c.x >= FREEDOM.detailsFrom).map(c => c.text.trim()).join(" ") }))
      .filter(line => line.text);
    const paragraphs: { top: number; bottom: number; lines: string[] }[] = [];
    for (const line of detailLines) {
      const last = paragraphs.at(-1);
      if (last && last.bottom - line.y <= 14) {
        last.lines.push(line.text);
        last.bottom = line.y;
      } else {
        paragraphs.push({ top: line.y, bottom: line.y, lines: [line.text] });
      }
    }
    for (const paragraph of paragraphs) {
      const inside = rows.find(row => row.y <= paragraph.top + 2 && row.y >= paragraph.bottom - 2 && row.details.length === 0);
      const target = inside ?? [...rows].sort((a, b) => Math.abs(a.y - paragraph.top) - Math.abs(b.y - paragraph.top))[0];
      target?.details.push(...paragraph.lines);
    }

    for (const row of rows) {
      if (row.currency && row.currency !== "KZT") continue;
      statement.rows.push({ date: row.date, amount: row.amount, operation: row.operation, details: row.details.join(" ").replace(/\s+/g, " ").trim() || row.operation, foreign: null });
    }
  });
  return statement;
}

// ── Alatau City Bank ─────────────────────────────────────

const ALATAU = { operationFrom: 185, detailsFrom: 258, amountFrom: 570, currencyFrom: 640, incomeFrom: 690, expenseFrom: 765 };

function parseAlatau(pages: TextItem[][]): ParsedStatement {
  const statement = emptyStatement("ALATAU");
  type Block = { date: DayKey; operation: string[]; details: string[]; income: string[]; expense: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;

  pages.forEach((items, pageIndex) => {
    const lines = toLines(items);
    lines.forEach((line, index) => {
      const text = joinLine(line);
      if (pageIndex === 0) {
        const period = /^За период/.test(text) ? periodOf(text) : null;
        if (period) { statement.periodFrom = period.from; statement.periodTo = period.to; }
        const card = text.match(/Номер карточки:\s*\d+\**(\d{4})/);
        if (card) statement.cardMask = `*${card[1]}`;
        const fio = text.match(/^ФИО:\s*(.+)$/);
        if (fio) statement.owner = ownerFrom(fio[1]);
        // «Остаток на ДД.ММ.ГГГГ» — сумма стоит на соседней строке правее подписи
        const balance = text.match(/^Остаток на (\d{2}\.\d{2}\.\d{4})/);
        if (balance) {
          const valueLine = lines.slice(Math.max(0, index - 1), index + 3)
            .find(l => Math.abs(l.y - line.y) <= 10 && l.cells.some(c => c.x > 200 && c.x < 330 && /\d/.test(c.text)));
          const value = valueLine ? parseBankNumber(valueLine.cells.filter(c => c.x > 200 && c.x < 330).map(c => c.text).join(""), true) : null;
          const date = fullDate(balance[1]);
          if (value !== null && date === statement.periodFrom) statement.openingBalance = value;
          if (value !== null && date === statement.periodTo) statement.closingBalance = value;
        }
      }

      const [first, second] = line.cells;
      const date = first && first.x < 100 ? fullDate(first.text) : null;
      if (date && second && fullDate(second.text)) {
        current = { date, operation: [], details: [], income: [], expense: [] };
        blocks.push(current);
      }
      if (!current) return;
      for (const cell of line.cells) {
        const value = cell.text.trim();
        if (!value) continue;
        if (cell.x >= ALATAU.expenseFrom) current.expense.push(value);
        else if (cell.x >= ALATAU.incomeFrom) current.income.push(value);
        else if (cell.x >= ALATAU.amountFrom) continue;
        else if (cell.x >= ALATAU.detailsFrom) current.details.push(value);
        else if (cell.x >= ALATAU.operationFrom && !/^\d{2}:\d{2}/.test(value)) current.operation.push(value);
      }
    });
    // Операции не переходят через страницу вместе с подписью внизу — начинаем заново
    current = null;
  });

  for (const block of blocks) {
    const amount = (parseBankNumber(block.income.join(""), true) ?? 0) - (parseBankNumber(block.expense.join(""), true) ?? 0);
    if (amount === 0) continue;
    const operation = block.operation.join(" ");
    statement.rows.push({ date: block.date, amount, operation, details: block.details.join(" ").replace(/\s+/g, " ").trim() || operation, foreign: null });
  }
  return statement;
}

// ── Общее ────────────────────────────────────────────────

export function detectStatement(pages: TextItem[][]): ParsedStatement | null {
  const head = pages.slice(0, 2).flat().map(i => i.text).join(" ");
  if (/ЦЕНТРКРЕДИТ|bcc\.kz/i.test(head) && /Выписка/.test(head)) return parseBcc(pages);
  if (/Фридом Банк|bankffin/i.test(head) && /Выписка/.test(head)) return parseFreedom(pages);
  if (/Alatau City Bank/i.test(head) && /Выписка/.test(head)) return parseAlatau(pages);
  if (isKaspiStatement(pages)) return { ...parseKaspiStatement(pages), bank: "KASPI_GOLD", owner: null };
  return null;
}

export function statementImportKeys(statement: ParsedStatement) {
  return importKeys(statement.rows, statement.bank === "KASPI_GOLD" ? "kaspi" : statement.bank.toLowerCase());
}

const BIK_BANKS: Record<string, string> = { KCJBKZKX: "БЦК", CASPKZKA: "Kaspi", KSNVKZKA: "Freedom", TSESKZKA: "Alatau", HSBKKZKX: "Halyk", IRTYKZKA: "Forte", KZKOKZKX: "Jusan" };

/** Короткое описание без служебных реквизитов: ИИН/БИН, счета, референсы */
export function cleanBankDetails(details: string) {
  const bik = details.match(/БИК:\s*([A-Z]{8})/)?.[1];
  const fio = details.match(/ФИО:\s*(.+?)\.?\s*(?:Мобильный|Референс|БИК|$)/)?.[1];
  let text = details
    .replace(/Референс:?\s*\S+/gi, "")
    .replace(/\b(Мобильный|БИК|DEP_ID|ID|COMTYPE):.*$/i, "")
    .replace(/,?\s*(ИИН|БИН)\s*\d{12}/g, "")
    .replace(/,?\s*счет\s*[A-Z]{2}[\dA-Z]{10,}(\s\d+)?/gi, "")
    .replace(/Плательщик:.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,:;]+$/, "")
    .trim();
  if (fio) text = `${/Пополнение/i.test(details) ? "От" : "Кому"}: ${fio.trim()}`;
  if (bik && BIK_BANKS[bik]) text = `${text} · ${BIK_BANKS[bik]}`;
  return text.length > 1 ? text.slice(0, 200) : "Без описания";
}

/** Упоминается ли в деталях сам владелец выписки: «Шаматов Азамат», «Азамат Ш.» */
export function mentionsOwner(details: string, owner: ParsedStatement["owner"]) {
  if (!owner) return false;
  const text = details.toLowerCase().replace(/ё/g, "е");
  const surname = owner.surname.toLowerCase().replace(/ё/g, "е");
  const name = owner.name.toLowerCase().replace(/ё/g, "е");
  return (text.includes(surname) && text.includes(name)) || text.includes(`${name} ${surname.charAt(0)}.`);
}

export type TransferCandidate = {
  // Сумма со знаком относительно счёта: минус — ушло со счёта
  amount: number;
  day: DayKey;
  // Точно перевод между своими счетами (владелец в деталях)
  own: boolean;
  cash: boolean;
};
export type TransferCounterpart = TransferCandidate & { id: string };

/**
 * Пары «ушло с одной своей карты — пришло на другую»: противоположная сумма, даты ±3 дня,
 * хотя бы одна сторона точно своя. Каждая операция участвует не больше чем в одной паре;
 * сначала связываются точно свои строки, затем ближайшие по дате.
 */
export function matchOwnTransfers(candidates: TransferCandidate[], counterparts: TransferCounterpart[], dayDiff: (a: DayKey, b: DayKey) => number) {
  const used = new Set<string>();
  const result = new Map<number, string>();
  const order = candidates.map((_, index) => index).sort((a, b) => Number(candidates[b].own) - Number(candidates[a].own));
  for (const index of order) {
    const candidate = candidates[index];
    const match = counterparts
      .filter(c => !used.has(c.id) && c.amount === -candidate.amount && c.cash === candidate.cash && (candidate.own || c.own) && Math.abs(dayDiff(c.day, candidate.day)) <= 3)
      .sort((a, b) => Math.abs(dayDiff(a.day, candidate.day)) - Math.abs(dayDiff(b.day, candidate.day)) || Number(b.own) - Number(a.own))[0];
    if (match) {
      used.add(match.id);
      result.set(index, match.id);
    }
  }
  return result;
}

export type PairItem = { id: string; accountId: string; amount: number; day: DayKey };

/**
 * Пары уже внесённых операций «расход на одной своей карте — поступление на другой».
 * `signal` оценивает пару: 2 — точно свои (владелец, «свой счёт», номер другой карты), 1 — вероятно
 * («с карты другого банка»), 0 — не связывать. Сильный признак допускает ±3 дня, слабый — ±1.
 */
export function pairOwnTransfers<T extends PairItem>(items: T[], signal: (out: T, incoming: T) => number, dayDiff: (a: DayKey, b: DayKey) => number) {
  const used = new Set<string>();
  const pairs: { out: T; incoming: T }[] = [];
  const outs = items.filter(i => i.amount < 0).sort((a, b) => a.day.localeCompare(b.day));
  for (const out of outs) {
    const options = items
      .filter(i => i.amount === -out.amount && i.accountId !== out.accountId && !used.has(i.id))
      .map(incoming => ({ incoming, strength: signal(out, incoming), distance: Math.abs(dayDiff(out.day, incoming.day)) }))
      .filter(o => o.strength > 0 && o.distance <= (o.strength >= 2 ? 3 : 1))
      .sort((a, b) => b.strength - a.strength || a.distance - b.distance);
    const best = options[0];
    if (!best) continue;
    used.add(best.incoming.id);
    pairs.push({ out, incoming: best.incoming });
  }
  return pairs;
}

// Транзит меньше этой суммы не ищем: мелкие совпадения чаще случайны
export const TRANSIT_MIN_AMOUNT = 10_000_00;

/**
 * Транзит друзей: поступление перевода и такой же исходящий перевод в пределах 2 дней (с любых своих карт).
 * Сначала связываются ближайшие по времени пары; уход раньше прихода допускается (заплатили за друга, он вернул).
 */
export function pairTransit<T extends PairItem>(items: T[], dayDiff: (a: DayKey, b: DayKey) => number) {
  const used = new Set<string>();
  const pairs: { incoming: T; out: T }[] = [];
  const incomings = items.filter(i => i.amount >= TRANSIT_MIN_AMOUNT).sort((a, b) => a.day.localeCompare(b.day));
  for (const incoming of incomings) {
    const out = items
      .filter(o => o.amount === -incoming.amount && !used.has(o.id))
      .map(o => ({ o, distance: dayDiff(incoming.day, o.day) }))
      .filter(({ distance }) => Math.abs(distance) <= 2)
      // Уход после прихода — естественный порядок, он выигрывает при равном расстоянии
      .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || b.distance - a.distance)[0]?.o;
    if (!out) continue;
    used.add(out.id);
    pairs.push({ incoming, out });
  }
  return pairs;
}

/** Насколько описание операции указывает на перевод между своими картами (см. pairOwnTransfers) */
export function ownTransferSignal(text: string, owner: ParsedStatement["owner"], otherAccountName: string) {
  if (mentionsOwner(text, owner) || /сво(й|его|ю) (сч[её]т|карт)/i.test(text)) return 2;
  const mask = text.match(/\*(\d{4})\b/)?.[1];
  if (mask && otherAccountName.includes(mask)) return 2;
  if (/(с|на) карт[уы] другого банка/i.test(text)) return 1;
  return 0;
}

export function classifyStatementRow(statement: ParsedStatement, row: KaspiRow): StatementDecision {
  if (statement.bank === "KASPI_GOLD") return classifyKaspiRow(row);

  const op = row.operation.toLowerCase();
  const raw = `${row.operation} ${row.details}`;
  const note = cleanBankDetails(row.details);
  const income = row.amount > 0;
  const direction = income ? "in" : "out";

  if (/кредит|погашение/i.test(op) || /погашение кредита|платеж по кредиту/i.test(raw)) {
    return { action: "import", kind: "EXPENSE", categoryKey: "debts", note, needsAi: false };
  }
  // Между своими счетами: в деталях владелец или «свой счёт», а также внесение наличных самим владельцем
  if (mentionsOwner(raw, statement.owner) || /сво(й|его) сч[её]т/i.test(raw)) {
    return { action: "own", direction, note: /наличн/i.test(raw) ? "Внесение наличных" : note };
  }
  if (op.startsWith("покупка") || op.startsWith("оплата")) {
    if (income) return { action: "import", kind: "INCOME", categoryKey: "gift_in", note: `Возврат: ${note}`, needsAi: false };
    const key = matchCategoryKey(row.details, "EXPENSE");
    return { action: "import", kind: "EXPENSE", categoryKey: key, note, needsAi: key === null };
  }
  if (op.startsWith("снятие")) return { action: "import", kind: "EXPENSE", categoryKey: "cash", note: note === "Снятие" ? "Снятие наличных" : note, needsAi: false };
  if (op.startsWith("комиссия")) return { action: "import", kind: "EXPENSE", categoryKey: "other", note: `Комиссия ${BANKS[statement.bank].short}`, needsAi: false };
  if (op.startsWith("кешбэк") || op.startsWith("кэшбэк")) return { action: "import", kind: "INCOME", categoryKey: "gift_in", note: "Кешбэк", needsAi: false };
  if (op.startsWith("перевод")) {
    return income
      ? { action: "import", kind: "INCOME", categoryKey: "gift_in", note: note === "Перевод" ? "Входящий перевод" : note, needsAi: false }
      : { action: "import", kind: "EXPENSE", categoryKey: "transfers", note: note === "Перевод" ? "Перевод" : note, needsAi: false };
  }
  if (op.startsWith("пополнение") || op.startsWith("зачисление")) {
    // Поступление от организации — как правило, зарплата
    const fromCompany = /(^|\s|")(ТОО|АО|ИП)\s|Плательщик/i.test(row.details);
    const key = fromCompany ? "salary" : matchCategoryKey(row.details, "INCOME") ?? "gift_in";
    return { action: "import", kind: "INCOME", categoryKey: key, note, needsAi: false };
  }
  return income
    ? { action: "import", kind: "INCOME", categoryKey: "other_in", note, needsAi: false }
    : { action: "import", kind: "EXPENSE", categoryKey: "other", note, needsAi: false };
}
