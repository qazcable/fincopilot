import { describe, expect, it } from "vitest";
import { classifyKaspiRow, findManualDuplicates, importKeys, isKaspiStatement, parseKaspiStatement, type KaspiRow, type TextItem } from "./kaspi";
import { daysBetween } from "./dates";

// Синтетическая страница в той же раскладке, что и выписка Kaspi Gold (координаты в пунктах PDF)
const cell = (y: number, x: number, text: string): TextItem => ({ x, y, text });
const row = (y: number, date: string, amount: string, amountX: number, operation: string, opX: number, details: string) => [
  cell(y, 52, date), cell(y, amountX, amount), cell(y, opX, operation), cell(y, 311, details),
];

const page: TextItem[] = [
  cell(712, 40, "Приложение к Справке №1 от 15 сентября 2026"),
  cell(674, 40, "ВЫПИСКА"),
  cell(654, 40, "по Kaspi Gold за период с 01.09.26 по 15.09.26"),
  cell(621, 327, "Номер карты:"), cell(621, 403, "*1234"),
  cell(592, 40, "Доступно на 15.09.26:"), cell(592, 218, "+ 14 067,47 ₸"),
  cell(516, 43, "Доступно на 01.09.26"), cell(516, 239, "+ 44 503,68 ₸"),
  cell(373, 43, "Доступно на 15.09.26"), cell(373, 239, "+ 14 067,47 ₸"),
  cell(334, 59, "Дата"), cell(334, 134, "Сумма"), cell(334, 243, "Операция"), cell(334, 312, "Детали"),
  ...row(318, "15.09.26", "- 1 060,00 ₸", 140, "Перевод", 254, "Серик Н."),
  ...row(302, "14.09.26", "- 5 313,00 ₸", 140, "Покупка", 257, "WOLT.COM"),
  ...row(286, "14.09.26", "+ 575,00 ₸", 145, "Пополнение", 238, "Артём В."),
  // Двухстрочная операция: «Перевод на свой / счет»
  ...row(270, "13.09.26", "- 237 888,00 ₸", 120, "Перевод на свой", 200, "Оплата Kaspi Кредита"),
  cell(254, 273, "счет"),
  ...row(238, "12.09.26", "+ 100,00 ₸", 145, "Поступление со", 200, "С Kaspi Депозита"),
  cell(222, 236, "своего счета"),
  // Покупка в валюте: сумма в валюте строкой ниже
  ...row(206, "11.09.26", "- 6 900,00 ₸", 140, "Покупка", 257, "GOOGLE *Telegram"),
  cell(190, 130, "(- 13,50 USD)"),
  ...row(174, "10.09.26", "- 20 000,00 ₸", 136, "Снятие", 258, "Банкомат Korzinka"),
  ...row(158, "10.09.26", "+ 1 490,00 ₸", 140, "Покупка", 257, "WOLT.COM"),
  ...row(142, "09.09.26", "- 1 490,00 ₸", 140, "Разное", 258, "Оплата за годовое обслуживание"),
  cell(28, 40, "АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz"),
];

describe("parseKaspiStatement", () => {
  const statement = parseKaspiStatement([page]);

  it("reads header: period, card and balances", () => {
    expect(isKaspiStatement([page])).toBe(true);
    expect(statement).toMatchObject({
      cardMask: "*1234",
      periodFrom: "2026-09-01",
      periodTo: "2026-09-15",
      openingBalance: 4_450_368,
      closingBalance: 1_406_747,
    });
  });

  it("parses rows including wrapped operations and foreign amounts", () => {
    expect(statement.rows).toHaveLength(9);
    expect(statement.rows[0]).toEqual({ date: "2026-09-15", amount: -106_000, operation: "Перевод", details: "Серик Н.", foreign: null });
    expect(statement.rows[3]).toMatchObject({ amount: -23_788_800, operation: "Перевод на свой счет", details: "Оплата Kaspi Кредита" });
    expect(statement.rows[4]).toMatchObject({ amount: 10_000, operation: "Поступление со своего счета" });
    expect(statement.rows[5]).toMatchObject({ details: "GOOGLE *Telegram", foreign: "- 13,50 USD" });
  });

  it("does not treat the page footer or summary as rows", () => {
    expect(statement.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });

  it("rejects other documents", () => {
    expect(isKaspiStatement([[cell(700, 40, "Счёт на оплату")]])).toBe(false);
  });
});

describe("classifyKaspiRow", () => {
  const r = (operation: string, amount: number, details: string): KaspiRow => ({ date: "2026-09-10", amount, operation, details, foreign: null });

  it("maps purchases, refunds and cash withdrawals", () => {
    expect(classifyKaspiRow(r("Покупка", -531_300, "WOLT.COM"))).toMatchObject({ action: "import", kind: "EXPENSE", categoryKey: "cafe", needsAi: false });
    expect(classifyKaspiRow(r("Покупка", -94_000, "ИП ДУДИНА С.П."))).toMatchObject({ kind: "EXPENSE", categoryKey: null, needsAi: true });
    expect(classifyKaspiRow(r("Покупка", 149_000, "WOLT.COM"))).toMatchObject({ kind: "INCOME", categoryKey: "gift_in", note: "Возврат: WOLT.COM" });
    expect(classifyKaspiRow(r("Снятие", -2_000_000, "Банкомат Korzinka"))).toMatchObject({ kind: "EXPENSE", categoryKey: "cash" });
    expect(classifyKaspiRow(r("Покупка", -195_000, "АЗС Заводская"))).toMatchObject({ categoryKey: "transport" });
  });

  it("maps transfers and top-ups", () => {
    expect(classifyKaspiRow(r("Перевод", -106_000, "Серик Н."))).toMatchObject({ kind: "EXPENSE", categoryKey: "transfers" });
    expect(classifyKaspiRow(r("Перевод", 3_000_000, "Диас К."))).toMatchObject({ kind: "INCOME", categoryKey: "gift_in" });
    expect(classifyKaspiRow(r("Пополнение", 57_500, "Артём В."))).toMatchObject({ kind: "INCOME", categoryKey: "gift_in" });
    expect(classifyKaspiRow(r("Пополнение", 5_000_000, "В Kaspi Терминале"))).toMatchObject({ kind: "INCOME", categoryKey: "other_in" });
    expect(classifyKaspiRow(r("Зачисление", 99_500_000, "Кредит Наличными"))).toMatchObject({ kind: "INCOME", categoryKey: "other_in" });
    expect(classifyKaspiRow(r("Разное", -149_000, "Оплата за годовое обслуживание"))).toMatchObject({ kind: "EXPENSE", categoryKey: "other" });
  });

  it("skips own transfers but keeps Kaspi loan payments as expenses", () => {
    expect(classifyKaspiRow(r("Перевод на свой счет", -500_000, "На Kaspi Депозит"))).toEqual({ action: "skip", reason: "own_transfer" });
    expect(classifyKaspiRow(r("Поступление со своего счета", 10_000, "С Kaspi Депозита"))).toEqual({ action: "skip", reason: "own_transfer" });
    expect(classifyKaspiRow(r("Перевод на свой счет", -23_788_800, "Оплата Kaspi Кредита"))).toMatchObject({ kind: "EXPENSE", categoryKey: "debts" });
  });
});

describe("importKeys", () => {
  it("is stable and distinguishes identical operations on the same day", () => {
    const rows: KaspiRow[] = [
      { date: "2026-09-10", amount: -50_000, operation: "Покупка", details: "Кофе", foreign: null },
      { date: "2026-09-10", amount: -50_000, operation: "Покупка", details: "Кофе", foreign: null },
    ];
    const keys = importKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
    expect(importKeys(rows)).toEqual(keys);
  });
});

describe("findManualDuplicates", () => {
  it("matches same kind and amount within one day, one-to-one", () => {
    const candidates = [
      { kind: "EXPENSE" as const, amount: 120_000, day: "2026-09-10" },
      { kind: "EXPENSE" as const, amount: 120_000, day: "2026-09-10" },
      { kind: "EXPENSE" as const, amount: 99_900, day: "2026-09-10" },
      { kind: "INCOME" as const, amount: 120_000, day: "2026-09-10" },
    ];
    const existing = [
      { id: "a", kind: "EXPENSE", amount: 120_000, day: "2026-09-11" },
      { id: "b", kind: "EXPENSE", amount: 99_900, day: "2026-09-13" },
    ];
    expect([...findManualDuplicates(candidates, existing, daysBetween)]).toEqual([0]);
  });
});
