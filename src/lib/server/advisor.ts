import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { getLimitsOverview } from "./limits";
import { askAdvisorAi, isAiConfigured, type AdvisorTurn } from "./ai";
import { addMonths, dayKeyOf, daysInMonth, formatDayKey, monthName, monthRange, parseKey, startOfDayInstant, weekdayOf } from "@/lib/domain/dates";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { simulatePayoff } from "@/lib/domain/payoff";
import { forecastHeadline } from "@/lib/domain/forecast";
import { getForecast } from "./forecast";
import { ACCOUNT_KINDS, NOT_TRANSIT, OBLIGATION_KINDS, type AccountKind, type ObligationKind } from "@/lib/domain/constants";

type AdvisorUser = { id: string; timezone: string; cushion: bigint; firstName: string | null };

// Бережём предоплаченный бюджет Gemini
const DAILY_QUESTIONS = 40;
const HISTORY_TURNS = 8;
const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;

const money = (minor: number) => formatMoney(Math.round(minor / 100) * 100);

function monthsText(months: number) {
  return months >= 12 ? `${Math.floor(months / 12)} г. ${months % 12} мес.` : `${months} мес.`;
}

/**
 * Сводка финансов для модели. Все цифры считает приложение — модель только объясняет и советует.
 * Сырые операции не отправляются: только итоги, категории и крупнейшие получатели.
 */
export async function buildAdvisorContext(user: AdvisorUser) {
  const snapshot = await getBudgetSnapshot(user);
  const { today, budget } = snapshot;
  const { year, month, day } = parseKey(today);
  const monthStarts = [-3, -2, -1, 0].map(delta => addMonths(year, month, delta));
  const since30 = startOfDayInstant(dayKeyOf(new Date(Date.now() - 30 * 86_400_000), user.timezone), user.timezone);

  const [monthly, limits, merchants, obligations, incomes] = await Promise.all([
    Promise.all(monthStarts.map(async m => {
      const range = monthRange(m.year, m.month, user.timezone);
      const sums = await prisma.transaction.groupBy({
        by: ["kind"],
        where: { userId: user.id, kind: { in: ["EXPENSE", "INCOME"] }, occurredAt: { gte: range.from, lt: range.to }, ...NOT_TRANSIT },
        _sum: { amount: true },
      });
      const sum = (kind: string) => fromDb(sums.find(s => s.kind === kind)?._sum.amount);
      return { ...m, expense: sum("EXPENSE"), income: sum("INCOME") };
    })),
    getLimitsOverview(user, year, month),
    prisma.transaction.groupBy({
      by: ["note"],
      where: { userId: user.id, kind: "EXPENSE", note: { not: null }, occurredAt: { gte: since30 }, ...NOT_TRANSIT },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 12,
    }),
    prisma.obligation.findMany({ where: { userId: user.id, completedAt: null }, orderBy: { dueDay: "asc" } }),
    prisma.recurringIncome.findMany({ where: { userId: user.id }, orderBy: { dayOfMonth: "asc" } }),
  ]);

  const lines: string[] = [];
  lines.push(`Сегодня ${formatDayKey(today)} ${year}, ${weekdayOf(today)}. Прошло ${day} из ${daysInMonth(year, month)} дней месяца.`);

  lines.push("", "БЮДЖЕТ ДО СЛЕДУЮЩЕГО ДОХОДА");
  lines.push(`Следующий доход: ${formatDayKey(snapshot.horizon)} (через ${budget.daysLeft} дн.)${snapshot.hasIncomeSchedule ? "" : " — день зарплаты не указан, взято 1-е число"}.`);
  const plannedForGoals = snapshot.goals.reduce((sum, g) => sum + g.plannedThisPeriod, 0);
  lines.push(`Деньги на счетах в лимите: ${money(snapshot.budgetBalance)}. Зарезервировано на платежи до дохода: ${money(budget.reserved - budget.reservedForGoals)}, подушка: ${money(fromDb(user.cushion))}.`);
  if (plannedForGoals > 0) {
    lines.push(`По плану целей в этом периоде нужно перевести в накопления ${money(plannedForGoals)}: уже переведено ${money(Math.max(0, plannedForGoals - budget.reservedForGoals))}, осталось перевести ${money(budget.reservedForGoals)} (эта сумма зарезервирована и вычтена из лимита).`);
  }
  lines.push(budget.free >= 0
    ? `Свободно до дохода: ${money(budget.free)}. Лимит на день: ${money(budget.dailyLimit)}, потрачено сегодня: ${money(snapshot.spentToday)}, осталось на сегодня: ${money(budget.leftToday)}.`
    : `Не хватает до дохода: ${money(-budget.free)} (обязательные платежи и цели больше, чем деньги на счетах).`);

  lines.push("", "СЧЕТА");
  for (const account of snapshot.accounts) {
    lines.push(`• ${account.name} (${ACCOUNT_KINDS[account.kind as AccountKind] ?? account.kind}${account.inBudget ? "" : ", не в лимите"}): ${money(account.balance)}`);
  }
  if (incomes.length > 0) {
    lines.push("", "РЕГУЛЯРНЫЕ ДОХОДЫ");
    for (const income of incomes) lines.push(`• ${income.title}: ${income.dayOfMonth} числа${income.amount !== null ? `, ~${money(fromDb(income.amount))}` : ""}`);
  }

  lines.push("", "ДОХОДЫ И РАСХОДЫ ПО МЕСЯЦАМ (переводы между своими счетами не учтены)");
  for (const m of monthly) {
    const current = m.year === year && m.month === month;
    lines.push(`• ${monthName(m.month)} ${m.year}${current ? ` (текущий, ${day} дн.)` : ""}: расходы ${money(m.expense)}, доходы ${money(m.income)}`);
  }

  const categories = limits.filter(c => c.spent > 0 || c.averageSpent > 0 || c.limit !== null).sort((a, b) => b.spent - a.spent);
  if (categories.length > 0) {
    lines.push("", `РАСХОДЫ ПО КАТЕГОРИЯМ: этот месяц / среднее в месяц за 3 прошлых месяца / лимит`);
    for (const c of categories) {
      lines.push(`• ${c.name}: ${money(c.spent)} / ${money(c.averageSpent)}${c.limit !== null ? ` / лимит ${money(c.limit)}` : ""}`);
    }
  }

  if (merchants.length > 0) {
    lines.push("", "КРУПНЕЙШИЕ ПОЛУЧАТЕЛИ ЗА 30 ДНЕЙ");
    for (const m of merchants) lines.push(`• ${m.note}: ${money(fromDb(m._sum.amount))} (${m._count._all} раз)`);
  }

  if (obligations.length > 0) {
    lines.push("", "КРЕДИТЫ И ОБЯЗАТЕЛЬНЫЕ ПЛАТЕЖИ");
    for (const o of obligations) {
      const kind = OBLIGATION_KINDS[o.kind as ObligationKind]?.label ?? o.kind;
      const monthly = fromDb(o.monthlyAmount);
      let line = `• ${o.title} (${kind}): платёж ${money(monthly)} ${o.dueDay} числа`;
      if (o.principalLeft !== null) {
        const left = fromDb(o.principalLeft);
        const rate = o.interestRate ?? 0;
        line += `, остаток ${money(left)}, ставка ${o.interestRate !== null ? `${o.interestRate}%` : "не указана (считаю 0%)"}`;
        const base = simulatePayoff(left, rate, monthly);
        if (base.feasible) {
          line += `; при текущем платеже закроется через ${monthsText(base.months)}, переплата ${money(base.totalInterest)}`;
          const extra = Math.round(monthly * 0.2);
          const faster = simulatePayoff(left, rate, monthly, extra);
          if (faster.feasible && faster.months < base.months) {
            line += `; с доплатой ${money(extra)}/мес — через ${monthsText(faster.months)}, экономия ${money(base.totalInterest - faster.totalInterest)}`;
          }
        } else {
          line += "; платёж не покрывает проценты";
        }
      }
      lines.push(line);
    }
  }
  const upcoming = snapshot.pendingPayments.filter(p => p.dueOn < snapshot.horizon);
  if (upcoming.length > 0) {
    lines.push(`Платежи до следующего дохода: ${upcoming.map(p => `${p.title} ${money(p.amount)} (${formatDayKey(p.dueOn)})`).join("; ")}`);
  }

  const forecast = await getForecast(user);
  const headline = forecastHeadline(forecast, today, money, day => formatDayKey(day));
  lines.push("", "ПРОГНОЗ ОСТАТКА НА 45 ДНЕЙ (счета в лимите, без целей)");
  lines.push(`${headline.title}. ${headline.text} Обычные траты в прогнозе: ${money(forecast.dailySpend)} в день.${forecast.incomeUnknown ? " Сумма зарплаты неизвестна — доход в прогнозе не учтён." : ""}`);

  if (snapshot.goals.length > 0) {
    lines.push("", "ЦЕЛИ НАКОПЛЕНИЙ");
    for (const g of snapshot.goals) {
      let line = `• ${g.title}: накоплено ${money(g.saved)} из ${money(g.targetAmount)} (${g.percent}%)`;
      if (g.targetDate) line += `, срок ${formatDayKey(g.targetDate)} ${g.targetDate.slice(0, 4)}`;
      if (g.plan.status === "on_track") line += `, нужно откладывать ${money(g.plannedThisPeriod || g.plan.perIncome)} с каждого дохода (взносов до срока: ${g.plan.incomesLeft + 1}, включая текущий период до ${formatDayKey(snapshot.horizon)})`;
      if (g.plan.status === "overdue") line += ", срок прошёл";
      if (g.plan.status === "done") line += ", достигнута";
      lines.push(line);
    }
  } else {
    lines.push("", "Целей накоплений пока нет.");
  }

  return lines.join("\n");
}

export type AdvisorAnswer =
  | { ok: true; answer: string }
  | { ok: false; reason: "unavailable" | "daily_limit" | "failed" };

/** Вопрос советнику: сохраняется в общую переписку бота и приложения */
export async function askAdvisor(user: AdvisorUser, question: string, source: "BOT" | "APP"): Promise<AdvisorAnswer> {
  const text = question.trim().slice(0, 1000);
  if (!isAiConfigured()) return { ok: false, reason: "unavailable" };

  const today = dayKeyOf(new Date(), user.timezone);
  const [askedToday, recent] = await Promise.all([
    prisma.advisorMessage.count({ where: { userId: user.id, role: "user", createdAt: { gte: startOfDayInstant(today, user.timezone) } } }),
    prisma.advisorMessage.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - HISTORY_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    }),
  ]);
  if (askedToday >= DAILY_QUESTIONS) return { ok: false, reason: "daily_limit" };

  const history: AdvisorTurn[] = recent.reverse().map(m => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text }));
  // Переписка должна начинаться с вопроса пользователя
  while (history[0]?.role === "assistant") history.shift();

  try {
    const context = await buildAdvisorContext(user);
    const answer = await askAdvisorAi(context, history, text);
    if (!answer) return { ok: false, reason: "failed" };
    await prisma.advisorMessage.createMany({
      data: [
        { userId: user.id, role: "user", text, source },
        { userId: user.id, role: "assistant", text: answer.slice(0, 8000), source },
      ],
    });
    return { ok: true, answer };
  } catch (error) {
    console.error("Advisor failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, reason: "failed" };
  }
}

export async function getAdvisorHistory(userId: string, take = 40) {
  const messages = await prisma.advisorMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  return messages.reverse().map(m => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text }));
}

export const ADVISOR_ERRORS: Record<Exclude<AdvisorAnswer, { ok: true }>["reason"], string> = {
  unavailable: "Советник сейчас недоступен — не настроен ИИ.",
  daily_limit: "На сегодня вопросы закончились (40 в день). Продолжим завтра 🙌",
  failed: "Не получилось ответить — ИИ перегружен. Попробуйте через минуту.",
};
