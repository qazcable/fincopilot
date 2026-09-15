// Валюты: основная валюта учёта пользователя, курсы Нацбанка РК и пересчёт между валютами

export const CURRENCIES = {
  KZT: { name: "Казахстанский тенге", short: "тенге", symbol: "₸", flag: "🇰🇿" },
  USD: { name: "Доллар США", short: "доллары", symbol: "$", flag: "🇺🇸" },
  EUR: { name: "Евро", short: "евро", symbol: "€", flag: "🇪🇺" },
  RUB: { name: "Российский рубль", short: "рубли", symbol: "₽", flag: "🇷🇺" },
  CNY: { name: "Китайский юань", short: "юани", symbol: "¥", flag: "🇨🇳" },
  KGS: { name: "Киргизский сом", short: "сомы", symbol: "сом", flag: "🇰🇬" },
  UZS: { name: "Узбекский сум", short: "сумы", symbol: "сўм", flag: "🇺🇿" },
  TRY: { name: "Турецкая лира", short: "лиры", symbol: "₺", flag: "🇹🇷" },
  GBP: { name: "Фунт стерлингов", short: "фунты", symbol: "£", flag: "🇬🇧" },
  AED: { name: "Дирхам ОАЭ", short: "дирхамы", symbol: "AED", flag: "🇦🇪" },
  GEL: { name: "Грузинский лари", short: "лари", symbol: "₾", flag: "🇬🇪" },
  AZN: { name: "Азербайджанский манат", short: "манаты", symbol: "₼", flag: "🇦🇿" },
  BYN: { name: "Белорусский рубль", short: "белорусские рубли", symbol: "Br", flag: "🇧🇾" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && Object.hasOwn(CURRENCIES, value);
}

export function currencyCode(value: string | null | undefined, fallback: CurrencyCode = "KZT"): CurrencyCode {
  return isCurrencyCode(value) ? value : fallback;
}

export const currencySymbol = (code: string) => (isCurrencyCode(code) ? CURRENCIES[code].symbol : code);

// Валюты, которые показываются первыми на экране курсов
export const POPULAR_RATES = ["USD", "EUR", "RUB", "CNY", "KGS", "UZS", "TRY", "GBP", "AED"];

export type NbkRate = {
  code: string;
  // Сколько тенге за 1 единицу валюты
  rate: number;
  // Изменение за день, тенге за 1 единицу
  change: number;
  direction: "UP" | "DOWN" | "SAME";
};

export type NbkRates = { date: string | null; rates: NbkRate[] };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? "";

/** RSS Нацбанка РК (nationalbank.kz/rss/rates_all.xml): курс указан за `quant` единиц валюты */
export function parseNbkRss(xml: string): NbkRates {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  let date: string | null = null;
  const rates: NbkRate[] = [];
  for (const item of items) {
    const code = tag(item, "title");
    const quant = Number(tag(item, "quant")) || 1;
    const value = Number(tag(item, "description").replace(",", "."));
    const change = Number(tag(item, "change").replace(",", ".")) || 0;
    const index = tag(item, "index").toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(value) || value <= 0) continue;
    const pub = tag(item, "pubDate").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (pub && !date) date = `${pub[3]}-${pub[2]}-${pub[1]}`;
    rates.push({ code, rate: value / quant, change: change / quant, direction: index === "UP" ? "UP" : index === "DOWN" ? "DOWN" : "SAME" });
  }
  return { date, rates };
}

/** Сколько тенге за 1 единицу валюты; для тенге — 1 */
export function kztPerUnit(code: string, rates: NbkRate[]) {
  if (code === "KZT") return 1;
  return rates.find(r => r.code === code)?.rate ?? null;
}

/** Пересчёт суммы в минимальных единицах (тиыны, центы) через тенге по курсу Нацбанка */
export function convertMinor(minor: number, from: string, to: string, rates: NbkRate[]): number | null {
  if (from === to) return minor;
  const fromRate = kztPerUnit(from, rates);
  const toRate = kztPerUnit(to, rates);
  if (!fromRate || !toRate) return null;
  return Math.round((minor * fromRate) / toRate);
}
