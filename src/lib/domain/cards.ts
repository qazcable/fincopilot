// Карточки-картинки для бота: что показать. Рисует их src/lib/server/cards.
// Суммы приходят уже отформатированными — рендер ничего не считает.
import { addDays, daysBetween, formatDayKey, pluralDays, relativeDays, type DayKey } from "./dates";
import { formatMoney } from "./money";
import { formatRange, type EveningInput, type MorningInput, type WeeklyInput } from "./digest";
import { stripHtml } from "./text";

export type CardTone = "accent" | "positive" | "negative" | "muted";

export type CardRow = { label: string; value: string; share?: number };

export type CardData = {
  /** Мелкая строка сверху: «Утро · 16 сентября» */
  eyebrow: string;
  label: string;
  amount: string;
  tone: CardTone;
  note?: string;
  progress?: { value: number; caption: string; tone: CardTone };
  chips?: { text: string; tone: CardTone }[];
  rowsTitle?: string;
  rows?: CardRow[];
  footer?: string;
  /** Значок вместо числа-акцента: цель достигнута, настройка завершена */
  badge?: "trophy" | "check";
};

const MAX_ROWS = 5;

export function morningCard(input: MorningInput, gapWarning: string | null): CardData {
  const { budget } = input;
  const over = budget.status === "over" && budget.free < 0;
  const until = input.hasIncomeSchedule ? `до зарплаты ${formatDayKey(input.horizon)}` : `до ${formatDayKey(input.horizon)}`;
  return {
    eyebrow: `Утро · ${formatDayKey(input.today)}`,
    label: over ? `До ${formatDayKey(input.horizon)} не хватает` : "Можно потратить сегодня",
    amount: formatMoney(over ? -budget.free : Math.max(0, budget.leftToday)),
    tone: over ? "negative" : "accent",
    note: over ? "Сегодня — только необходимое" : `${pluralDays(budget.daysLeft)} ${until}`,
    chips: [
      ...(over ? [] : [{ text: `Свободно до дохода ${formatMoney(Math.max(0, budget.free))}`, tone: "muted" as const }]),
      ...(gapWarning ? [{ text: gapWarning, tone: "negative" as const }] : []),
    ],
    rowsTitle: input.duePayments.length ? "Платежи" : undefined,
    rows: input.duePayments.slice(0, MAX_ROWS).map(p => ({
      label: p.title,
      value: `${formatMoney(p.amount)} · ${relativeDays(daysBetween(input.today, p.dueOn))}`,
    })),
  };
}

export function eveningCard(input: EveningInput): CardData {
  const { budget } = input;
  const limit = budget.dailyLimit;
  const over = input.spentToday > limit;
  const salaryTomorrow = addDays(input.today, 1) >= input.horizon;
  return {
    eyebrow: `Итоги дня · ${formatDayKey(input.today)}`,
    label: input.spentToday === 0 ? "Трат сегодня не записано" : "Потрачено сегодня",
    amount: formatMoney(input.spentToday),
    tone: over ? "negative" : input.spentToday === 0 ? "muted" : "positive",
    progress: limit > 0 && input.spentToday > 0
      ? {
        value: input.spentToday / limit,
        caption: over ? `на ${formatMoney(input.spentToday - limit)} больше лимита ${formatMoney(limit)}` : `из лимита ${formatMoney(limit)}`,
        tone: over ? "negative" : "positive",
      }
      : undefined,
    chips: input.incomeToday > 0 ? [{ text: `Поступления ${formatMoney(input.incomeToday, { sign: true })}`, tone: "positive" }] : undefined,
    rowsTitle: input.topCategories.length ? "Куда ушли деньги" : undefined,
    rows: input.topCategories.slice(0, 3).map(c => ({
      label: c.name,
      value: formatMoney(c.amount),
      share: input.spentToday > 0 ? c.amount / Math.max(input.spentToday, c.amount) : 0,
    })),
    footer: salaryTomorrow ? "Завтра зарплата" : `Завтра можно ${formatMoney(input.tomorrowLimit)}`,
  };
}

export function weeklyCard(input: WeeklyInput): CardData {
  const days = daysBetween(input.from, input.to) + 1;
  const chips: CardData["chips"] = [];
  if (input.previousExpense > 0) {
    const delta = Math.round(((input.expense - input.previousExpense) / input.previousExpense) * 100);
    chips.push(delta === 0
      ? { text: "Как на прошлой неделе", tone: "muted" }
      : { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}% к прошлой неделе`, tone: delta > 0 ? "negative" : "positive" });
  }
  if (input.income > 0) chips.push({ text: `Доходы ${formatMoney(input.income)}`, tone: "positive" });
  return {
    eyebrow: `Неделя · ${formatRange(input.from, input.to)}`,
    label: input.expense === 0 ? "За неделю трат не записано" : "Расходы за неделю",
    amount: formatMoney(input.expense),
    tone: input.expense === 0 ? "muted" : "accent",
    note: input.expense > 0 ? `В среднем ${formatMoney(Math.round(input.expense / days / 100) * 100)} в день` : undefined,
    chips,
    rowsTitle: input.categories.length ? "Куда ушли деньги" : undefined,
    rows: input.categories.slice(0, MAX_ROWS).map(c => ({
      label: c.name,
      value: formatMoney(c.amount),
      share: input.expense > 0 ? c.amount / input.expense : 0,
    })),
  };
}

export type SetupCardInput = {
  firstName: string | null;
  today: DayKey;
  horizon: DayKey;
  hasIncomeSchedule: boolean;
  leftToday: number;
  daysLeft: number;
  trial: boolean;
  welcomeBack?: boolean;
};

/** Итог настройки в чате и «с возвращением» */
export function setupCard(input: SetupCardInput): CardData {
  const until = input.hasIncomeSchedule ? `до зарплаты ${formatDayKey(input.horizon)}` : `до ${formatDayKey(input.horizon)}`;
  const name = input.firstName ? `, ${input.firstName}` : "";
  return {
    eyebrow: input.welcomeBack ? `С возвращением${name}` : `Готово${name}`,
    label: "Можно потратить сегодня",
    amount: formatMoney(Math.max(0, input.leftToday)),
    tone: "accent",
    note: `${pluralDays(input.daysLeft)} ${until}`,
    chips: input.trial ? [{ text: "Pro на 14 дней включён", tone: "accent" }] : undefined,
    badge: input.welcomeBack ? undefined : "check",
  };
}

export function goalCard(input: { title: string; amount: number; days: number }): CardData {
  return {
    eyebrow: "Цель достигнута",
    label: input.title,
    amount: formatMoney(input.amount),
    tone: "positive",
    note: input.days > 0 ? `за ${pluralDays(input.days)}` : undefined,
    badge: "trophy",
  };
}

/** Высота картинки под содержимое, чтобы не было пустого места */
export function cardHeight(card: CardData) {
  let height = card.note ? 560 : 520;
  if (card.badge) height += 112;
  if (card.progress) height += 100;
  if (card.chips?.length) height += 80;
  if (card.rows?.length) height += 76 + card.rows.length * 72;
  if (card.footer) height += 104;
  return height;
}

const CAPTION_LIMIT = 1024;

/**
 * Подпись к фото ограничена 1024 символами. Если текст длиннее — в подпись идёт первый абзац,
 * остальное отправляется отдельным сообщением.
 */
export function fitCaption(html: string, limit = CAPTION_LIMIT): { caption: string | null; rest: string | null } {
  if (stripHtml(html).length <= limit) return { caption: html, rest: null };
  const split = html.indexOf("\n\n");
  if (split > 0 && stripHtml(html.slice(0, split)).length <= limit) {
    return { caption: html.slice(0, split), rest: html.slice(split + 2) };
  }
  return { caption: null, rest: html };
}
