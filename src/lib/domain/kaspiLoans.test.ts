import { describe, expect, it } from "vitest";
import { isKaspiLoanStatement, parseKaspiLoanStatement } from "./kaspiLoans";
import { isKaspiStatement, type TextItem } from "./kaspi";

// Синтетическая страница в раскладке «Выписки по кредитам» Kaspi
const cell = (y: number, x: number, text: string): TextItem => ({ x, y, text });
const op = (y: number, date: string, amount: string, operation: string, details: string, contractDate?: string): TextItem[] => [
  cell(y, 44, date), cell(y, 111, amount), cell(y, 178, operation), cell(y, 284, details), cell(y, 437, "0,00 т"),
  ...(contractDate ? [cell(y - 10, 224, contractDate)] : []),
];

const page: TextItem[] = [
  cell(712, 35, "ВЫПИСКА"),
  cell(694, 35, "по кредитам за период с 15.09.25 по 15.09.26"),
  cell(243, 50, "Дата"), cell(243, 129, "Сумма"), cell(243, 225, "Операция"), cell(243, 284, "Детали"),
  ...op(230, "30.09.25", "-600 000,00 т", "Кредит Наличными от", "Выдача Кредита Наличными", "30.09.2025"),
  ...op(200, "21.07.26", "+60 000,00 т", "Поступление", "С Kaspi Gold"),
  ...op(180, "22.07.26", "-24 385,00 т", "Кредит Наличными от", "Списание безналичными", "30.09.2025"),
  ...op(160, "22.07.26", "-9 835,64 т", "Кредит Наличными от", "Полное досрочное погашение", "05.10.2025"),
  ...op(140, "22.08.26", "-24 385,00 т", "Кредит Наличными от", "Списание безналичными", "30.09.2025"),
  ...op(120, "22.08.26", "-35 568,00 т", "Кредит на Покупки от", "Оплата ежемесячного платежа", "21.06.2026"),
  ...op(100, "22.08.26", "-4 998,00 т", "Кредит на Покупки от", "Оплата ежемесячного платежа", "21.06.2026"),
];

describe("Kaspi loan statement", () => {
  it("is detected and not confused with a card statement", () => {
    expect(isKaspiLoanStatement([page])).toBe(true);
    expect(isKaspiStatement([[...page, cell(50, 284, "С Kaspi Gold")]])).toBe(false);
  });

  it("finds active contracts, monthly payments and the due day", () => {
    const result = parseKaspiLoanStatement([page]);
    expect(result.periodTo).toBe("2026-09-15");
    expect(result.dueDay).toBe(22);
    expect(result.closedContracts).toBe(1);
    expect(result.contracts).toEqual([
      { title: "Кредит Наличными от 30.09.2025", kind: "CASH", openedOn: "2025-09-30", monthlyPayment: 2_438_500, lastPaymentOn: "2026-08-22" },
      // Две части договора в один день складываются
      { title: "Кредит на Покупки от 21.06.2026", kind: "PURCHASE", openedOn: "2026-06-21", monthlyPayment: 4_056_600, lastPaymentOn: "2026-08-22" },
    ]);
    expect(result.totalMonthly).toBe(6_495_100);
  });
});
