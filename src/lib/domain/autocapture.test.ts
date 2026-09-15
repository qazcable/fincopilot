import { describe, expect, it } from "vitest";
import { accountForCard, parseBankSms, parseWalletAmount } from "./autocapture";

describe("parseWalletAmount", () => {
  it("understands regional formats", () => {
    expect(parseWalletAmount("1 300,00 ₸")).toEqual({ amount: 130_000, currency: "KZT" });
    expect(parseWalletAmount("₸1,300.00")).toEqual({ amount: 130_000, currency: "KZT" });
    expect(parseWalletAmount("₸1,300")).toEqual({ amount: 130_000, currency: "KZT" });
    expect(parseWalletAmount("1300")).toEqual({ amount: 130_000, currency: "KZT" });
    expect(parseWalletAmount("12 500 KZT")).toEqual({ amount: 1_250_000, currency: "KZT" });
    expect(parseWalletAmount("$23.20")).toEqual({ amount: 2_320, currency: "OTHER" });
    expect(parseWalletAmount("—")).toBeNull();
  });
});

describe("accountForCard", () => {
  const accounts = [
    { id: "deposit", name: "Kaspi Депозит", isDefault: false, kind: "SAVINGS" },
    { id: "kaspi", name: "Kaspi", isDefault: true },
    { id: "bcc", name: "Банк ЦентрКредит *5214", isDefault: false },
    { id: "freedom", name: "Freedom Bank *1912", isDefault: false },
  ];
  it("finds the account by card digits or bank", () => {
    expect(accountForCard("Visa •••• 5214", accounts)?.id).toBe("bcc");
    expect(accountForCard("BCC Card", accounts)?.id).toBe("bcc");
    expect(accountForCard("Freedom", accounts)?.id).toBe("freedom");
    expect(accountForCard("Kaspi Gold", accounts)?.id).toBe("kaspi");
    expect(accountForCard("Kaspi Gold", [{ id: "main", name: "Основная карта", isDefault: true }])?.id).toBe("main");
    expect(accountForCard("Halyk", accounts)).toBeNull();
  });
});

describe("parseBankSms", () => {
  it("takes the operation amount, not the balance", () => {
    expect(parseBankSms("Покупка 1 300,00 KZT KORZINKA. Карта *5214. Доступно 32 958,92 KZT")).toEqual({
      amount: 130_000, kind: "EXPENSE", note: "KORZINKA", cardDigits: "5214",
    });
    expect(parseBankSms("Остаток 50 000 тг. Оплата 2500 тг Yandex Go")).toMatchObject({ amount: 250_000, note: "Yandex Go" });
  });

  it("detects income and ignores unrelated messages", () => {
    expect(parseBankSms("Пополнение +336 500.00 KZT от ТОО Ромашка. Баланс 400 000.00 KZT")).toMatchObject({ amount: 33_650_000, kind: "INCOME", note: "от ТОО Ромашка" });
    expect(parseBankSms("Код подтверждения 1234")).toBeNull();
  });
});
