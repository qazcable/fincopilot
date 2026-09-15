// Тексты итогов для бота. Чистые функции: данные собираются на сервере, здесь только формулировки.
import { addDays, formatDayKey, MONTHS_GENITIVE, parseKey, pluralDays, relativeDays, daysBetween, weekdayOf, type DayKey } from "./dates";
import { formatMoney } from "./money";
import { limitProgress } from "./limits";
import { escapeHtml } from "./text";
import type { BudgetResult } from "./budget";

export type CategoryAmount = { emoji: string; name: string; amount: number };
export type LimitLine = { emoji: string; name: string; spent: number; limit: number };
export type DuePayment = { title: string; amount: number; dueOn: DayKey };

/** Предыдущая полная неделя (понедельник–воскресенье) относительно сегодняшнего дня */
export function previousWeek(today: DayKey) {
  const { year, month, day } = parseKey(today);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 — воскресенье
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = addDays(today, -daysSinceMonday);
  return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
}

export function isMonday(today: DayKey) {
  return weekdayOf(today) === "понедельник";
}

/** "8–14 сентября" или "29 сентября – 5 октября" */
export function formatRange(from: DayKey, to: DayKey) {
  const a = parseKey(from);
  const b = parseKey(to);
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${MONTHS_GENITIVE[b.month - 1]}`;
  return `${a.day} ${MONTHS_GENITIVE[a.month - 1]} – ${b.day} ${MONTHS_GENITIVE[b.month - 1]}`;
}

function limitLines(limits: LimitLine[], onlyWarnings: boolean) {
  return limits
    .map(line => ({ line, progress: limitProgress(line.spent, line.limit) }))
    .filter(({ progress }) => !onlyWarnings || progress.state !== "ok")
    .sort((a, b) => b.progress.percent - a.progress.percent)
    .map(({ line, progress }) => {
      const mark = progress.state === "over" ? "🚫" : progress.state === "warn" ? "⚠️" : "•";
      return `${mark} ${line.emoji} ${escapeHtml(line.name)} — ${formatMoney(line.spent)} из ${formatMoney(line.limit)} (${progress.percent}%)`;
    });
}

// ── Утро ─────────────────────────────────────────────────

export type MorningInput = {
  today: DayKey;
  horizon: DayKey;
  hasIncomeSchedule: boolean;
  budget: BudgetResult;
  duePayments: DuePayment[];
  limits: LimitLine[];
};

export function formatMorning(input: MorningInput) {
  const { budget } = input;
  const lines: string[] = [];

  if (budget.status === "over" && budget.free < 0) {
    lines.push(`☀️ До ${formatDayKey(input.horizon)} не хватает <b>${formatMoney(-budget.free)}</b> на обязательные платежи.`);
    lines.push("Сегодня лучше обойтись без необязательных трат.");
  } else {
    lines.push(`☀️ Сегодня можно потратить <b>${formatMoney(Math.max(0, budget.leftToday))}</b>`);
    const until = input.hasIncomeSchedule ? `до зарплаты ${formatDayKey(input.horizon)}` : `до ${formatDayKey(input.horizon)}`;
    lines.push(`${pluralDays(budget.daysLeft)} ${until}`);
  }

  if (input.duePayments.length > 0) {
    lines.push("", "🔔 <b>Платежи</b>");
    for (const payment of input.duePayments) {
      lines.push(`• ${escapeHtml(payment.title)} — ${formatMoney(payment.amount)}, ${relativeDays(daysBetween(input.today, payment.dueOn))}`);
    }
  }

  const warnings = limitLines(input.limits, true);
  if (warnings.length > 0) lines.push("", "<b>Лимиты на месяц</b>", ...warnings);

  return lines.join("\n");
}

// ── Вечер ────────────────────────────────────────────────

export type EveningInput = {
  today: DayKey;
  horizon: DayKey;
  budget: BudgetResult;
  // Траты за день без оплат по графику (они не входят в лимит на день)
  spentToday: number;
  incomeToday: number;
  topCategories: CategoryAmount[];
  tomorrowLimit: number;
};

export function formatEvening(input: EveningInput) {
  const { budget } = input;
  const lines: string[] = ["🌙 <b>Итоги дня</b>"];

  if (input.spentToday === 0) {
    lines.push("Сегодня трат не записано.");
    lines.push("Если что-то было — напишите сюда, например: <code>обед 2500</code>");
  } else if (input.spentToday <= budget.dailyLimit) {
    lines.push(`Потрачено <b>${formatMoney(input.spentToday)}</b> из ${formatMoney(budget.dailyLimit)} ✅`);
  } else {
    lines.push(`Потрачено <b>${formatMoney(input.spentToday)}</b> — на ${formatMoney(input.spentToday - budget.dailyLimit)} больше лимита`);
  }

  if (input.topCategories.length > 0) {
    lines.push("", ...input.topCategories.map(c => `${c.emoji} ${escapeHtml(c.name)} — ${formatMoney(c.amount)}`));
  }
  if (input.incomeToday > 0) lines.push("", `💰 Поступления: ${formatMoney(input.incomeToday, { sign: true })}`);

  lines.push("");
  if (addDays(input.today, 1) >= input.horizon) {
    lines.push("Завтра зарплата 🎉");
  } else {
    lines.push(`Завтра можно будет <b>${formatMoney(input.tomorrowLimit)}</b>`);
  }
  return lines.join("\n");
}

// ── Неделя ───────────────────────────────────────────────

export type WeeklyInput = {
  from: DayKey;
  to: DayKey;
  expense: number;
  previousExpense: number;
  income: number;
  categories: CategoryAmount[];
  limits: LimitLine[];
};

export function formatWeekly(input: WeeklyInput) {
  const lines: string[] = [`📊 <b>Неделя ${formatRange(input.from, input.to)}</b>`];
  const days = daysBetween(input.from, input.to) + 1;

  if (input.expense === 0 && input.income === 0) {
    lines.push("За неделю операций не записано.");
    return lines.join("\n");
  }

  let expenseLine = `Расходы: <b>${formatMoney(input.expense)}</b>`;
  if (input.previousExpense > 0) {
    const delta = Math.round(((input.expense - input.previousExpense) / input.previousExpense) * 100);
    expenseLine += delta === 0 ? " (как на прошлой неделе)" : ` (${delta > 0 ? "+" : "−"}${Math.abs(delta)}% к прошлой)`;
  }
  lines.push(expenseLine);
  if (input.income > 0) lines.push(`Доходы: ${formatMoney(input.income)}`);
  lines.push(`В среднем в день: ${formatMoney(Math.round(input.expense / days / 100) * 100)}`);

  if (input.categories.length > 0) {
    lines.push("", "<b>Куда ушли деньги</b>");
    for (const category of input.categories.slice(0, 5)) {
      const share = input.expense > 0 ? Math.round((category.amount / input.expense) * 100) : 0;
      lines.push(`${category.emoji} ${escapeHtml(category.name)} — ${formatMoney(category.amount)} · ${share}%`);
    }
  }

  const limits = limitLines(input.limits, false);
  if (limits.length > 0) lines.push("", "<b>Лимиты на месяц</b>", ...limits);

  return lines.join("\n");
}

/** Сводка всех лимитов на месяц — ответ на /limits */
export function formatLimits(limits: LimitLine[]) {
  if (limits.length === 0) {
    return "Лимиты по категориям не заданы. Настроить их можно в приложении: Аналитика → Лимиты.";
  }
  return ["<b>Лимиты на месяц</b>", ...limitLines(limits, false)].join("\n");
}

// ── Предупреждение о лимите ──────────────────────────────

export function formatLimitAlert(line: LimitLine, level: 80 | 100) {
  const progress = limitProgress(line.spent, line.limit);
  const name = `${line.emoji} ${escapeHtml(line.name)}`;
  if (level === 100) {
    return `🚫 Лимит «${name}» исчерпан: ${formatMoney(line.spent)} из ${formatMoney(line.limit)} (${progress.percent}%)`;
  }
  return `⚠️ ${name}: потрачено ${formatMoney(line.spent)} из ${formatMoney(line.limit)} (${progress.percent}%). До конца месяца осталось ${formatMoney(progress.left)}`;
}

/** Строка для чека после траты в категории с лимитом */
export function formatLimitReceiptLine(line: LimitLine) {
  const progress = limitProgress(line.spent, line.limit);
  const mark = progress.state === "over" ? "🚫" : progress.state === "warn" ? "⚠️" : "📊";
  return `${mark} ${escapeHtml(line.name)}: ${formatMoney(line.spent)} из ${formatMoney(line.limit)} в этом месяце (${progress.percent}%)`;
}
