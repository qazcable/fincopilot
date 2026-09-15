// Работа с календарными датами в часовом поясе пользователя.
// "Ключ дня" — строка YYYY-MM-DD; арифметика над ключами не зависит от часового пояса сервера.

export type DayKey = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(instant).map(p => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function dayKeyOf(instant: Date, timeZone: string): DayKey {
  const { year, month, day } = zonedParts(instant, timeZone);
  return makeKey(year, month, day);
}

export function makeKey(year: number, month: number, day: number): DayKey {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseKey(key: DayKey) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseKey(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(key: DayKey, days: number): DayKey {
  const { year, month, day } = parseKey(key);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return makeKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addMonths(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function daysBetween(from: DayKey, to: DayKey) {
  const a = parseKey(from);
  const b = parseKey(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** День месяца, ограниченный длиной месяца: 31-е в феврале → 28/29 */
export function clampedDay(year: number, month: number, day: number): DayKey {
  return makeKey(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Момент начала локального дня (для запросов к БД по диапазону) */
export function startOfDayInstant(key: DayKey, timeZone: string): Date {
  const { year, month, day } = parseKey(key);
  const utcGuess = Date.UTC(year, month - 1, day);
  let instant = utcGuess - offsetMs(new Date(utcGuess), timeZone);
  // Повторная коррекция на случай перехода через смену смещения
  instant = utcGuess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

function offsetMs(instant: Date, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function monthRange(year: number, month: number, timeZone: string) {
  const next = addMonths(year, month, 1);
  return {
    from: startOfDayInstant(makeKey(year, month, 1), timeZone),
    to: startOfDayInstant(makeKey(next.year, next.month, 1), timeZone),
  };
}

/** Локальные дата и время "YYYY-MM-DDTHH:mm" → момент */
export function localDateTimeToInstant(value: string, timeZone: string): Date | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match || !isDayKey(match[1])) return null;
  const start = startOfDayInstant(match[1], timeZone);
  return new Date(start.getTime() + (Number(match[2]) * 60 + Number(match[3])) * 60_000);
}

export function instantToLocalInput(instant: Date, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  return `${makeKey(p.year, p.month, p.day)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOMINATIVE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function formatDayKey(key: DayKey, today?: DayKey) {
  if (today) {
    const diff = daysBetween(today, key);
    if (diff === 0) return "Сегодня";
    if (diff === 1) return "Завтра";
    if (diff === -1) return "Вчера";
  }
  const { day, month } = parseKey(key);
  return `${day} ${MONTHS_GENITIVE[month - 1]}`;
}

const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

/** "20 сент." — для компактных строк */
export function formatDayKeyShort(key: DayKey) {
  const { day, month } = parseKey(key);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function weekdayOf(key: DayKey) {
  const { year, month, day } = parseKey(key);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function monthName(month: number) {
  return MONTHS_NOMINATIVE[month - 1];
}

export function formatTime(instant: Date, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "через 3 дня", "сегодня", "просрочен на 2 дня" */
export function relativeDays(diff: number) {
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff > 0) return `через ${pluralDays(diff)}`;
  return `просрочен на ${pluralDays(-diff)}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function pluralDays(n: number) {
  return `${n} ${plural(n, "день", "дня", "дней")}`;
}
