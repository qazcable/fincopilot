// Автоматическая запись операций: оплаты Apple Wallet и SMS банков (через автоматизации «Команд» iPhone)
import { BANKS, type BankCode } from "./statements";

export type AutoAmount = { amount: number; currency: "KZT" | "OTHER" };

/**
 * Сумма транзакции Wallet приходит строкой в формате региона телефона: «1 300,00 ₸», «₸1,300.00», «1300 KZT», «$23.20».
 * Возвращает тиыны и признак валюты.
 */
export function parseWalletAmount(raw: string): AutoAmount | null {
  const text = raw.replace(/[  ]/g, " ").trim();
  const currency = /₸|KZT|тг|тенге/i.test(text) || !/[$€£₽]|USD|EUR|RUB|GBP/i.test(text) ? "KZT" : "OTHER";
  const digits = text.replace(/[^\d.,\s-]/g, "").trim().replace(/\s+/g, "");
  if (!/\d/.test(digits)) return null;

  let normalized = digits.replace(/^-/, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  // Разделитель считается десятичным, только если после него 1–2 цифры: «1,300» — это тысяча триста
  if (decimalIndex >= 0 && normalized.length - decimalIndex - 1 <= 2) {
    normalized = normalized.slice(0, decimalIndex).replace(/[.,]/g, "") + "." + normalized.slice(decimalIndex + 1);
  } else {
    normalized = normalized.replace(/[.,]/g, "");
  }
  const value = Math.round(Number(normalized) * 100);
  return Number.isFinite(value) && value > 0 ? { amount: value, currency } : null;
}

/** Счёт по названию карты в Wallet: номер карты в названии счёта или банк */
export function accountForCard<T extends { id: string; name: string; isDefault: boolean; kind?: string }>(cardName: string, all: T[]): T | null {
  // Оплата картой не может идти с депозита или накоплений
  const accounts = all.filter(a => a.kind !== "SAVINGS");
  const digits = cardName.match(/\d{4}/g)?.at(-1);
  if (digits) {
    const byDigits = accounts.find(a => a.name.includes(digits));
    if (byDigits) return byDigits;
  }
  for (const code of Object.keys(BANKS) as BankCode[]) {
    if (!BANKS[code].nameHints.test(cardName)) continue;
    const byBank = accounts.find(a => BANKS[code].nameHints.test(a.name));
    if (byBank) return byBank;
    // Kaspi Gold — основная карта, даже если счёт называется иначе
    if (code === "KASPI_GOLD") return accounts.find(a => a.isDefault) ?? null;
  }
  return null;
}

export type SmsParsed = { amount: number; kind: "EXPENSE" | "INCOME"; note: string; cardDigits: string | null };

const AMOUNT_WITH_CURRENCY = /([+-]?\d[\d\s ]*(?:[.,]\d{1,2})?)\s*(?:₸|KZT|тг\.?|тенге)/gi;
const BALANCE_WORDS = /(доступно|остаток|баланс|бал\.|available|balance|лимит)/i;
const INCOME_WORDS = /(пополнение|зачисление|поступление|получен|возврат|перевод от|входящий|кешбэк|кэшбэк|cashback|refund)/i;
const EXPENSE_WORDS = /(покупка|оплата|списание|снятие|перевод|платеж|платёж|purchase|payment)/i;

/**
 * SMS банка: «Покупка 1 300,00 KZT KORZINKA. Карта *5214. Доступно 32 958,92 KZT».
 * Берётся первая сумма в тенге, которая не относится к балансу; описание — текст без служебных частей.
 */
export function parseBankSms(text: string): SmsParsed | null {
  const clean = text.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
  if (!INCOME_WORDS.test(clean) && !EXPENSE_WORDS.test(clean)) return null;

  let amount: number | null = null;
  let amountEnd = 0;
  for (const match of clean.matchAll(AMOUNT_WITH_CURRENCY)) {
    const before = clean.slice(Math.max(0, match.index! - 25), match.index!);
    if (BALANCE_WORDS.test(before)) continue;
    const parsed = parseWalletAmount(`${match[1]} ₸`);
    if (parsed) {
      amount = parsed.amount;
      amountEnd = match.index! + match[0].length;
      break;
    }
  }
  if (amount === null) return null;

  const kind = INCOME_WORDS.test(clean) && !/(покупка|оплата|снятие)/i.test(clean) ? "INCOME" : "EXPENSE";
  const cardDigits = clean.match(/\*+\s?(\d{4})/)?.[1] ?? null;
  const note = clean
    .slice(amountEnd)
    .replace(new RegExp(`${BALANCE_WORDS.source}.*$`, "i"), "")
    .replace(/(карта|card|счет|счёт)\s*\*+\s?\d{4}/gi, "")
    .replace(/\*+\s?\d{4}/g, "")
    .replace(/\d{1,2}[.:]\d{2}([.:]\d{2,4})?/g, "")
    .replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, "")
    .trim();
  return { amount, kind, note: (note || (kind === "INCOME" ? "Поступление" : "Покупка")).slice(0, 120), cardDigits };
}
