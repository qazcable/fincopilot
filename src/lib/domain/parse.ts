import { parseAmount } from "./money";
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY_KEY, type TxKind } from "./constants";

export type QuickParseResult = {
  amount: number;
  kind: TxKind;
  note: string;
  categoryKey: string | null;
};

const NUMBER_PATTERN = /(?:^|\s)\+?(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s*(к|k|тыс\.?|тысяч[аи]?))?(?=\s|$)/gi;
const CURRENCY_WORDS = /(?:^|\s)(тг|тенге|₸|kzt|тнг)(?=\s|$|[.,!])/gi;
const INCOME_HINTS = ["зарплат", "зп", "аванс", "получил", "получила", "пришл", "доход", "кэшбэк", "кешбэк", "cashback", "вернул", "возврат", "перевели", "подработк", "гонорар"];

function words(text: string) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function matchCategoryKey(text: string, kind: TxKind): string | null {
  const lower = text.toLowerCase();
  const tokens = words(text);
  for (const category of DEFAULT_CATEGORIES) {
    if (category.kind !== kind) continue;
    const hit = category.keywords.some(keyword =>
      keyword.includes(" ") ? lower.includes(keyword) : tokens.some(token => token.startsWith(keyword))
    );
    if (hit) return category.key;
  }
  return null;
}

/**
 * Быстрый разбор без ИИ: ровно одна сумма и произвольное описание.
 * "кофе 1200", "1 200 такси", "+250 000 зарплата", "обед 2.5к тг".
 * Если сумм несколько или нет ни одной — null (дальше разбирает ИИ).
 */
export function quickParse(input: string): QuickParseResult | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text || text.length > 200) return null;

  const matches = [...text.matchAll(NUMBER_PATTERN)];
  if (matches.length !== 1) return null;

  const match = matches[0];
  const amount = parseAmount(match[0].trim().replace(/^\+/, ""));
  if (amount === null) return null;

  const note = (text.slice(0, match.index) + " " + text.slice(match.index! + match[0].length))
    .replace(CURRENCY_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:,.]+|[-–—:,.]+$/g, "")
    .trim();

  const explicitPlus = match[0].trim().startsWith("+");
  const tokens = words(note);
  const kind: TxKind = explicitPlus || INCOME_HINTS.some(h => tokens.some(t => t.startsWith(h))) ? "INCOME" : "EXPENSE";

  return {
    amount,
    kind,
    note: note.charAt(0).toUpperCase() + note.slice(1),
    categoryKey: note ? matchCategoryKey(note, kind) : FALLBACK_CATEGORY_KEY[kind],
  };
}
