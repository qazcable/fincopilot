import { describe, expect, it } from "vitest";
import {
  classifyStatementRow, cleanBankDetails, matchOwnTransfers, mentionsOwner, ownTransferSignal, pairOwnTransfers, pairTransit, parseBankNumber, type ParsedStatement,
} from "./statements";
import { daysBetween } from "./dates";

const owner = { surname: "Иванов", name: "Арман" };
const statement = (bank: ParsedStatement["bank"]): ParsedStatement => ({
  bank, owner, cardMask: "*1234", periodFrom: null, periodTo: null, openingBalance: null, closingBalance: null, rows: [],
});
const row = (operation: string, amount: number, details: string) => ({ date: "2026-08-11", amount, operation, details, foreign: null });

describe("bank numbers", () => {
  it("parses formats of different banks", () => {
    expect(parseBankNumber("-2 000.00 KZT")).toBe(-200_000);
    expect(parseBankNumber("-100 000.0" + "0 KZT")).toBe(-10_000_000);
    expect(parseBankNumber("+21,000.00 ₸")).toBe(2_100_000);
    expect(parseBankNumber("375 000", true)).toBe(37_500_000);
    expect(parseBankNumber("1 234,50", true)).toBe(123_450);
    expect(parseBankNumber("KZT")).toBeNull();
  });
});

describe("details and owner", () => {
  it("removes requisites and keeps who sent money", () => {
    expect(cleanBankDetails('ТОО "Ромашка", ИИН 140240010735, счет KZ5885622031458 37267 Плательщик: ТОО "Ромашка"')).toBe('ТОО "Ромашка"');
    expect(cleanBankDetails("Пополнение. ФИО: Арман И.. Мобильный: . Референс: KSP1. БИК: CASPKZKA. DEP_ID: 1")).toBe("От: Арман И. · Kaspi");
  });

  it("recognizes the owner by full name or name with initial", () => {
    expect(mentionsOwner("ФИО: Иванов Арман Сергеевич", owner)).toBe(true);
    expect(mentionsOwner("Арман И.", owner)).toBe(true);
    expect(mentionsOwner("Арман К.", owner)).toBe(false);
    expect(mentionsOwner("Иванов Арман", null)).toBe(false);
  });
});

describe("classifyStatementRow", () => {
  it("maps operations of other banks", () => {
    const bcc = statement("BCC");
    expect(classifyStatementRow(bcc, row("Покупка", -154_400, "KORZINKA SUPERMARKET"))).toMatchObject({ action: "import", kind: "EXPENSE", categoryKey: "food" });
    expect(classifyStatementRow(bcc, row("Пополнение от", 18_599_900, 'ТОО "Ромашка", ИИН 140240010735'))).toMatchObject({ kind: "INCOME", categoryKey: "salary" });
    expect(classifyStatementRow(bcc, row("Перевод от", 5_000_000, "Диас К."))).toMatchObject({ kind: "INCOME", categoryKey: "gift_in" });
    expect(classifyStatementRow(bcc, row("Перевод", -200_000, "Перевод"))).toMatchObject({ kind: "EXPENSE", categoryKey: "transfers" });
    expect(classifyStatementRow(bcc, row("Снятие", -2_000_000, "Снятие"))).toMatchObject({ categoryKey: "cash", note: "Снятие наличных" });
  });

  it("marks transfers between own cards", () => {
    const freedom = statement("FREEDOM");
    expect(classifyStatementRow(freedom, row("Пополнение", 2_100_000, "Пополнение. ФИО: Иванов Арман Сергеевич. Мобильный: . БИК: KCJBKZKX."))).toMatchObject({ action: "own", direction: "in" });
    expect(classifyStatementRow(freedom, row("Пополнение", 37_500_000, "Зачисление наличных … отправитель Иванов Арман"))).toEqual({ action: "own", direction: "in", note: "Внесение наличных" });
  });
});

describe("pairOwnTransfers", () => {
  const items = [
    { id: "bcc-out", accountId: "bcc", amount: -30_000_000, day: "2026-07-10", text: "Перевод" },
    { id: "kaspi-in", accountId: "kaspi", amount: 30_000_000, day: "2026-07-10", text: "С карты другого банка" },
    { id: "kaspi-out", accountId: "kaspi", amount: -2_000_000, day: "2026-07-11", text: "На карту Банк ЦентрКредит*5214" },
    { id: "bcc-in", accountId: "bcc", amount: 2_000_000, day: "2026-07-12", text: "Входящий перевод" },
    // Перевод знакомому и совпавшая по сумме поступление — не свои
    { id: "friend-out", accountId: "bcc", amount: -1_000_000, day: "2026-03-14", text: "Перевод" },
    { id: "friend-in", accountId: "kaspi", amount: 1_000_000, day: "2026-03-14", text: "Елизавета А." },
    // Слабый признак, но слишком далеко по дате
    { id: "late-out", accountId: "bcc", amount: -500_000, day: "2026-05-01", text: "Перевод" },
    { id: "late-in", accountId: "kaspi", amount: 500_000, day: "2026-05-03", text: "С карты другого банка" },
  ];
  const names: Record<string, string> = { bcc: "Банк ЦентрКредит *5214", kaspi: "Kaspi" };

  it("links own transfers by strong and weak signals and skips strangers", () => {
    const pairs = pairOwnTransfers(
      items,
      (out, incoming) => Math.max(ownTransferSignal(out.text, owner, names[incoming.accountId]), ownTransferSignal(incoming.text, owner, names[out.accountId])),
      daysBetween
    );
    expect(pairs.map(p => `${p.out.id}>${p.incoming.id}`)).toEqual(["bcc-out>kaspi-in", "kaspi-out>bcc-in"]);
  });
});

describe("pairTransit", () => {
  it("pairs a friend's money that came in and went out within 2 days", () => {
    const items = [
      { id: "in", accountId: "kaspi", amount: 150_000_00, day: "2026-09-01" },
      { id: "out", accountId: "bcc", amount: -150_000_00, day: "2026-09-02" },
      { id: "far-out", accountId: "kaspi", amount: -150_000_00, day: "2026-09-10" },
      { id: "small-in", accountId: "kaspi", amount: 2_000_00, day: "2026-09-03" },
      { id: "small-out", accountId: "kaspi", amount: -2_000_00, day: "2026-09-03" },
    ];
    expect(pairTransit(items, daysBetween).map(p => `${p.incoming.id}>${p.out.id}`)).toEqual(["in>out"]);
  });
});

describe("matchOwnTransfers", () => {
  it("pairs opposite amounts within 3 days when one side is surely own", () => {
    const candidates = [
      { amount: 2_100_000, day: "2026-08-11", own: true, cash: false },
      { amount: -500_000, day: "2026-08-11", own: false, cash: false },
      { amount: -700_000, day: "2026-08-11", own: false, cash: false },
    ];
    const counterparts = [
      { id: "far", amount: -2_100_000, day: "2026-08-20", own: false, cash: false },
      { id: "bcc", amount: -2_100_000, day: "2026-08-12", own: false, cash: false },
      { id: "stranger", amount: 500_000, day: "2026-08-11", own: false, cash: false },
      { id: "skipped-own", amount: 700_000, day: "2026-08-13", own: true, cash: false },
    ];
    expect(matchOwnTransfers(candidates, counterparts, daysBetween)).toEqual(new Map([[0, "bcc"], [2, "skipped-own"]]));
  });

  it("does not pair cash deposits with ordinary transfers", () => {
    const result = matchOwnTransfers(
      [{ amount: 37_500_000, day: "2026-08-21", own: true, cash: true }],
      [{ id: "t", amount: -37_500_000, day: "2026-08-21", own: false, cash: false }],
      daysBetween
    );
    expect(result.size).toBe(0);
  });
});
