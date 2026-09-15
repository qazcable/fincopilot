// Прогноз остатка по дням: доходы, платежи по графику и обычные траты — где случится кассовый разрыв и когда он закроется
import { addDays, addMonths, clampedDay, parseKey, type DayKey } from "./dates";

export type ForecastEvent = { title: string; amount: number; kind: "income" | "payment" };

export type ForecastDay = {
  day: DayKey;
  // Остаток на конец дня
  balance: number;
  events: ForecastEvent[];
};

export type ForecastInput = {
  today: DayKey;
  days: number;
  // Деньги на счетах в лимите на сегодня (сегодняшние траты уже вычтены)
  balance: number;
  // Обычные траты в день (без платежей по графику)
  dailySpend: number;
  incomes: { title: string; dayOfMonth: number; amount: number }[];
  payments: { title: string; dueOn: DayKey; amount: number }[];
};

export type ForecastResult = {
  points: ForecastDay[];
  minBalance: number;
  minDay: DayKey;
  // Первый день, когда остаток уходит в минус; null — разрыва нет
  gapStart: DayKey | null;
  // Первый день после разрыва, когда остаток снова не меньше нуля; null — не закрывается в горизонте прогноза
  gapEnd: DayKey | null;
};

/** Даты дохода в диапазоне (from, to] — по дню месяца, с поправкой на короткие месяцы */
function incomeDates(from: DayKey, to: DayKey, dayOfMonth: number) {
  const dates: DayKey[] = [];
  const { year, month } = parseKey(from);
  for (let offset = 0; offset <= 13; offset++) {
    const m = addMonths(year, month, offset);
    const date = clampedDay(m.year, m.month, dayOfMonth);
    if (date > from && date <= to) dates.push(date);
  }
  return dates;
}

export function forecastBalance(input: ForecastInput): ForecastResult {
  const end = addDays(input.today, input.days);
  const events = new Map<DayKey, ForecastEvent[]>();
  const push = (day: DayKey, event: ForecastEvent) => events.set(day, [...(events.get(day) ?? []), event]);

  for (const income of input.incomes) {
    if (income.amount <= 0) continue;
    for (const day of incomeDates(input.today, end, income.dayOfMonth)) push(day, { title: income.title, amount: income.amount, kind: "income" });
  }
  for (const payment of input.payments) {
    // Просроченные и сегодняшние неоплаченные платежи ожидаются завтра
    const day = payment.dueOn <= input.today ? addDays(input.today, 1) : payment.dueOn;
    if (day <= end) push(day, { title: payment.title, amount: -payment.amount, kind: "payment" });
  }

  const points: ForecastDay[] = [{ day: input.today, balance: input.balance, events: [] }];
  let balance = input.balance;
  for (let i = 1; i <= input.days; i++) {
    const day = addDays(input.today, i);
    const dayEvents = events.get(day) ?? [];
    balance += dayEvents.reduce((sum, e) => sum + e.amount, 0) - input.dailySpend;
    points.push({ day, balance, events: dayEvents });
  }

  let min = points[0];
  for (const point of points) if (point.balance < min.balance) min = point;
  const gapIndex = points.findIndex(p => p.balance < 0);
  const endIndex = gapIndex >= 0 ? points.findIndex((p, i) => i > gapIndex && p.balance >= 0) : -1;
  return {
    points,
    minBalance: min.balance,
    minDay: min.day,
    gapStart: gapIndex >= 0 ? points[gapIndex].day : null,
    gapEnd: endIndex >= 0 ? points[endIndex].day : null,
  };
}

export type ForecastHeadline = { tone: "good" | "warning" | "critical"; title: string; text: string };

/** Главный вывод прогноза одной фразой — для главной, бота и советника */
export function forecastHeadline(
  result: ForecastResult & { incomeUnknown?: boolean },
  today: DayKey,
  format: (minor: number) => string,
  formatDay: (day: DayKey) => string
): ForecastHeadline {
  const headline = headlineOf(result, today, format, formatDay);
  return result.incomeUnknown ? { ...headline, text: `${headline.text} Зарплата не учтена — укажите её сумму.` } : headline;
}

function headlineOf(result: ForecastResult, today: DayKey, format: (minor: number) => string, formatDay: (day: DayKey) => string): ForecastHeadline {
  const end = result.points.at(-1)!.day;
  if (!result.gapStart) {
    return { tone: "good", title: "Кассовых разрывов нет", text: `До ${formatDay(end)} денег хватит. Самый низкий остаток — ${format(result.minBalance)} (${formatDay(result.minDay)}).` };
  }
  const deficit = format(-result.minBalance);
  const closes = result.gapEnd ? `закроется ${formatDay(result.gapEnd)}` : `не закроется до ${formatDay(end)}`;
  const soon = result.gapStart <= addDays(today, 7);
  return {
    tone: soon || !result.gapEnd ? "critical" : "warning",
    title: `Разрыв с ${formatDay(result.gapStart)}`,
    text: `Не хватит до ${deficit} (${formatDay(result.minDay)}), ${closes}.`,
  };
}

/**
 * Обычные траты в день по истории: суммы по дням за период, без самых крупных дней (~10%),
 * чтобы разовая покупка вроде оплаты учёбы не раздувала прогноз.
 */
export function typicalDailySpend(dailyTotals: number[], periodDays: number) {
  if (periodDays <= 0) return 0;
  const totals = [...dailyTotals, ...Array(Math.max(0, periodDays - dailyTotals.length)).fill(0)].sort((a, b) => b - a);
  const trimmed = totals.slice(Math.round(totals.length * 0.1));
  return Math.round(trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length / 100) * 100;
}

/** Ожидаемая зарплата: среднее поступлений категории «Зарплата» за месяцы, когда она была */
export function expectedMonthlyIncome(monthlyTotals: number[]) {
  const nonZero = monthlyTotals.filter(v => v > 0);
  if (nonZero.length === 0) return 0;
  return Math.round(nonZero.reduce((sum, v) => sum + v, 0) / nonZero.length / 100) * 100;
}
