export const TX_KINDS = ["EXPENSE", "INCOME"] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const TX_SOURCES = ["APP", "BOT_TEXT", "BOT_VOICE", "SHORTCUT", "PAYMENT", "IMPORT", "WALLET", "SMS"] as const;
export type TxSource = (typeof TX_SOURCES)[number];

export const ACCOUNT_KINDS = {
  CARD: "Карта",
  CASH: "Наличные",
  SAVINGS: "Накопления",
} as const;
export type AccountKind = keyof typeof ACCOUNT_KINDS;

export const OBLIGATION_KINDS = {
  LOAN: { label: "Кредит", emoji: "🏦", hasPrincipal: true },
  CREDIT_CARD: { label: "Кредитная карта", emoji: "💳", hasPrincipal: true },
  INSTALLMENT: { label: "Рассрочка", emoji: "🛍️", hasPrincipal: true },
  BILL: { label: "Регулярный платёж", emoji: "🧾", hasPrincipal: false },
} as const;
export type ObligationKind = keyof typeof OBLIGATION_KINDS;

export const PAYMENT_STATUSES = ["PENDING", "PAID", "SKIPPED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isOneOf<T extends string>(list: readonly T[] | Record<T, unknown>, value: unknown): value is T {
  if (typeof value !== "string") return false;
  return Array.isArray(list) ? list.includes(value as T) : Object.hasOwn(list, value);
}

export type DefaultCategory = {
  key: string;
  name: string;
  kind: TxKind;
  emoji: string;
  color: string;
  // Корни слов для быстрого автоподбора без ИИ
  keywords: string[];
};

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: "food", name: "Продукты", kind: "EXPENSE", emoji: "🛒", color: "#22C55E", keywords: ["продукт", "магнум", "magnum", "small", "смолл", "галмарт", "galmart", "anvar", "анвар", "супермаркет", "магазин", "хлеб", "молоко", "овощ", "фрукт", "мясо", "вкусвилл", "arbuz", "арбуз", "superprice", "toimart", "korzinka", "корзинка", "ramstore", "живая вода", "supermarket", "супермаркет", "market", "маркет", "мясн", "myasn", "пив", "beer"] },
  { key: "cafe", name: "Кафе и доставка", kind: "EXPENSE", emoji: "☕", color: "#F59E0B", keywords: ["кофе", "кафе", "ресторан", "обед", "ужин", "завтрак", "ланч", "бургер", "пицц", "суши", "шаурм", "доставк", "wolt", "glovo", "starbucks", "кофейн", "бар", "coffee", "kfc", "mcdonald", "burger", "dodo", "додо", "chocofood", "yandex.eda", "яндекс еда", "бистро", "bistro", "restaurant", "тандыр", "tandyr"] },
  { key: "transport", name: "Транспорт", kind: "EXPENSE", emoji: "🚕", color: "#3B82F6", keywords: ["такси", "яндекс go", "yandex.go", "yandex go", "yandex.taxi", "uber", "indrive", "индрайв", "автобус", "метро", "бензин", "заправк", "парковк", "проезд", "онай", "onay", "азс", "helios", "sinooil", "qazaq oil", "газпром", "gazprom", "avtobys", "munay", "шинторг"] },
  { key: "home", name: "Дом и ЖКХ", kind: "EXPENSE", emoji: "🏠", color: "#8B5CF6", keywords: ["аренд", "квартир", "коммунал", "жкх", "электроэнерг", "энергосбыт", "водоканал", "газоснаб", "интернет", "казахтелеком", "kazakhtelecom", "ремонт"] },
  { key: "health", name: "Здоровье", kind: "EXPENSE", emoji: "💊", color: "#EF4444", keywords: ["аптек", "атек", "pharm", "лекарств", "врач", "клиник", "анализ", "стоматолог", "зуб", "оптик"] },
  { key: "fun", name: "Развлечения", kind: "EXPENSE", emoji: "🎬", color: "#EC4899", keywords: ["кино", "концерт", "игр", "steam", "подписк", "netflix", "spotify", "кальян", "боулинг", "театр", "telegram", "youtube", "apple.com", "google", "yandex.plus", "chaplin", "kinopark", "gamingclub", "shisha", "tattoo"] },
  { key: "shopping", name: "Покупки", kind: "EXPENSE", emoji: "🛍️", color: "#14B8A6", keywords: ["одежд", "обув", "кроссовк", "техник", "wildberries", "вайлдберриз", "ozon", "озон", "kaspi магазин", "подарок", "technodom", "технодом", "koton", "sneaker", "flowers", "зоотовар", "инструмент"] },
  { key: "mobile", name: "Связь", kind: "EXPENSE", emoji: "📱", color: "#06B6D4", keywords: ["связь", "телефон", "мобильн", "beeline", "билайн", "kcell", "tele2", "activ", "altel"] },
  { key: "sport", name: "Спорт", kind: "EXPENSE", emoji: "🏋️", color: "#84CC16", keywords: ["спортзал", "фитнес", "зал", "бассейн", "тренир", "абонемент"] },
  { key: "debts", name: "Кредиты и счета", kind: "EXPENSE", emoji: "🧾", color: "#64748B", keywords: ["кредит", "кредитк", "рассрочк", "ипотек", "долг", "zaim", "займ"] },
  { key: "transfers", name: "Переводы людям", kind: "EXPENSE", emoji: "💸", color: "#F97316", keywords: ["перевод", "перевел", "перевёл", "скинул", "отправил"] },
  { key: "cash", name: "Снятие наличных", kind: "EXPENSE", emoji: "🏧", color: "#78716C", keywords: ["банкомат", "наличн", "снял", "снятие"] },
  { key: "tobacco", name: "Табак", kind: "EXPENSE", emoji: "🚬", color: "#A16207", keywords: ["сигарет", "сигар", "табак", "tobacco", "iqos", "айкос", "heets", "хитс", "terea", "терея", "стики", "вейп", "vape", "электронк", "одноразк", "жидкость для", "marlboro", "мальборо", "winston", "винстон", "parliament", "парламент", "kent", "кент"] },
  { key: "education", name: "Образование", kind: "EXPENSE", emoji: "🎓", color: "#6366F1", keywords: ["университет", "university", "вуз", "обучени", "учеб", "колледж", "college", "академи", "academy", "курсы", "school", "школ", "репетитор", "контракт за обучение"] },
  { key: "other", name: "Другое", kind: "EXPENSE", emoji: "📦", color: "#A1A1AA", keywords: [] },
  { key: "salary", name: "Зарплата", kind: "INCOME", emoji: "💼", color: "#10B981", keywords: ["зарплат", "зп", "аванс", "оклад"] },
  { key: "side", name: "Подработка", kind: "INCOME", emoji: "🧑‍💻", color: "#0EA5E9", keywords: ["подработк", "фриланс", "заказ", "гонорар"] },
  { key: "gift_in", name: "Переводы и подарки", kind: "INCOME", emoji: "🎁", color: "#F472B6", keywords: ["перевел", "перевёл", "подарил", "вернул", "возврат", "кэшбэк", "кешбэк", "cashback"] },
  { key: "other_in", name: "Другой доход", kind: "INCOME", emoji: "💰", color: "#22D3EE", keywords: [] },
];

export const FALLBACK_CATEGORY_KEY: Record<TxKind, string> = {
  EXPENSE: "other",
  INCOME: "other_in",
};

export const DEBT_CATEGORY_KEY = "debts";
