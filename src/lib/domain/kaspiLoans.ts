// «Выписка по кредитам» Kaspi: движение по счёту погашения — поступления с Kaspi Gold и списания по каждому договору.
// Остатка долга в ней нет, зато видно действующие договоры, ежемесячные платежи и день списания.
import { makeKey, type DayKey } from "./dates";
import { toLines, type TextItem } from "./kaspi";

export type LoanContract = {
  // «Кредит на Покупки от 21.06.2026»
  title: string;
  kind: "CASH" | "PURCHASE";
  openedOn: DayKey | null;
  // Последний ежемесячный платёж, тиыны
  monthlyPayment: number;
  lastPaymentOn: DayKey;
};

export type KaspiLoanStatement = {
  periodFrom: DayKey | null;
  periodTo: DayKey | null;
  contracts: LoanContract[];
  totalMonthly: number;
  // День месяца, в который Kaspi списывает платежи
  dueDay: number | null;
  closedContracts: number;
};

const shortDate = (text: string): DayKey | null => {
  const m = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return m ? makeKey(2000 + Number(m[3]), Number(m[2]), Number(m[1])) : null;
};
const fullDate = (text: string): DayKey | null => {
  const m = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? makeKey(Number(m[3]), Number(m[2]), Number(m[1])) : null;
};

/** «-11 937,00 т» → -1 193 700 */
function money(text: string): number | null {
  const m = text.replace(/[  ]/g, " ").trim().match(/^([+-])\s*([\d\s]+),(\d{2})\s*(т|₸)$/);
  if (!m) return null;
  const value = Number(m[2].replace(/\s/g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -value : value;
}

export function isKaspiLoanStatement(pages: TextItem[][]) {
  const text = pages.slice(0, 1).flat().map(i => i.text).join(" ");
  return /ВЫПИСКА/.test(text) && /по кредитам за период/i.test(text);
}

// Столбцы таблицы (пункты PDF)
const COL = { amountFrom: 95, operationFrom: 170, detailsFrom: 280, balanceFrom: 425 };

type LoanRow = { date: DayKey; amount: number; operation: string; contractDate: DayKey | null; details: string };

export function parseKaspiLoanStatement(pages: TextItem[][]): KaspiLoanStatement {
  let periodFrom: DayKey | null = null;
  let periodTo: DayKey | null = null;
  const rows: LoanRow[] = [];

  for (const items of pages) {
    let current: LoanRow | null = null;
    for (const line of toLines(items)) {
      const joined = line.cells.map(c => c.text.trim()).join(" ");
      const period = joined.match(/по кредитам за период с (\d{2}\.\d{2}\.\d{2}) по (\d{2}\.\d{2}\.\d{2})/);
      if (period && !periodFrom) {
        periodFrom = shortDate(period[1]);
        periodTo = shortDate(period[2]);
      }

      const first = line.cells[0];
      const date = first && first.x < COL.amountFrom ? shortDate(first.text) : null;
      const amountCell = line.cells.find(c => c.x >= COL.amountFrom && c.x < COL.operationFrom + 10 && money(c.text) !== null);
      if (date && amountCell) {
        current = {
          date,
          amount: money(amountCell.text)!,
          operation: line.cells.filter(c => c.x >= COL.operationFrom && c.x < COL.detailsFrom && c !== amountCell).map(c => c.text.trim()).join(" "),
          contractDate: null,
          details: line.cells.filter(c => c.x >= COL.detailsFrom && c.x < COL.balanceFrom).map(c => c.text.trim()).join(" "),
        };
        rows.push(current);
        continue;
      }
      // Перенос строки: дата договора под названием операции и продолжение деталей
      if (current) {
        for (const cell of line.cells) {
          const text = cell.text.trim();
          if (cell.x >= COL.operationFrom && cell.x < COL.detailsFrom && fullDate(text)) current.contractDate = fullDate(text);
          else if (cell.x >= COL.detailsFrom && cell.x < COL.balanceFrom) current.details = `${current.details} ${text}`.trim();
        }
        current = null;
      }
    }
  }

  // Договоры: регулярные списания и досрочные погашения
  const byContract = new Map<string, { kind: LoanContract["kind"]; openedOn: DayKey | null; payments: LoanRow[]; closedOn: DayKey | null }>();
  for (const row of rows) {
    const kind = /наличн/i.test(row.operation) ? "CASH" : /покупк/i.test(row.operation) ? "PURCHASE" : null;
    if (!kind || row.amount >= 0 || /выдача/i.test(row.details)) continue;
    const key = `${kind}|${row.contractDate ?? "?"}`;
    const entry = byContract.get(key) ?? { kind, openedOn: row.contractDate, payments: [], closedOn: null };
    if (/досрочное погашение/i.test(row.details)) entry.closedOn = row.date;
    else entry.payments.push(row);
    byContract.set(key, entry);
  }

  const lastPaymentDay = rows.filter(r => /ежемесячного платежа|списание безналичными/i.test(r.details)).map(r => r.date).sort().at(-1) ?? null;
  const lastMonth = lastPaymentDay?.slice(0, 7);

  const contracts: LoanContract[] = [];
  let closedContracts = 0;
  for (const entry of byContract.values()) {
    const last = entry.payments.at(-1);
    const closed = entry.closedOn !== null && (!last || entry.closedOn >= last.date);
    if (closed) {
      closedContracts++;
      continue;
    }
    // Действующий — есть платёж в последнем месяце списаний; у договора может быть несколько частей в один день
    if (!last || last.date.slice(0, 7) !== lastMonth) continue;
    const monthlyPayment = entry.payments.filter(p => p.date === last.date).reduce((sum, p) => sum - p.amount, 0);
    contracts.push({
      title: `${entry.kind === "CASH" ? "Кредит Наличными" : "Кредит на Покупки"}${entry.openedOn ? ` от ${entry.openedOn.split("-").reverse().join(".")}` : ""}`,
      kind: entry.kind,
      openedOn: entry.openedOn,
      monthlyPayment,
      lastPaymentOn: last.date,
    });
  }
  contracts.sort((a, b) => (a.openedOn ?? "").localeCompare(b.openedOn ?? ""));

  return {
    periodFrom,
    periodTo,
    contracts,
    totalMonthly: contracts.reduce((sum, c) => sum + c.monthlyPayment, 0),
    dueDay: lastPaymentDay ? Number(lastPaymentDay.slice(8, 10)) : null,
    closedContracts,
  };
}
