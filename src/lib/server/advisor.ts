import "server-only";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { getLimitsOverview } from "./limits";
import { askAdvisorAi, isAiConfigured, streamAdvisorAi, type AdvisorTurn } from "./ai";
import { addMonths, dayKeyOf, daysInMonth, formatDayKey, monthName, monthRange, parseKey, startOfDayInstant, weekdayOf } from "@/lib/domain/dates";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { simulatePayoff } from "@/lib/domain/payoff";
import { forecastHeadline } from "@/lib/domain/forecast";
import { getForecast } from "./forecast";
import { peerSums } from "./peer";
import { isOwner } from "./access-rules";
import { planState } from "@/lib/domain/plan";
import { ACCOUNT_KINDS, NOT_PEER_OUT, NOT_TRANSIT, OBLIGATION_KINDS, PEER_IN_WHERE, netPeer, type AccountKind, type ObligationKind } from "@/lib/domain/constants";

type AdvisorUser = {
  id: string; timezone: string; cushion: bigint; firstName: string | null; telegramId: bigint;
  // Советник входит в Pro
  plan: string; proUntil: Date | null; trialEndsAt: Date | null;
};

// Бережём предоплаченный бюджет Gemini: владельцу больше, приглашённым тестировщикам — меньше
const OWNER_DAILY_QUESTIONS = 40;
const GUEST_DAILY_QUESTIONS = 15;
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

  const [monthly, limits, merchants, obligations, incomes, debts] = await Promise.all([
    Promise.all(monthStarts.map(async m => {
      const range = monthRange(m.year, m.month, user.timezone);
      const [sums, peer] = await Promise.all([
        prisma.transaction.groupBy({
          by: ["kind"],
          where: { userId: user.id, kind: { in: ["EXPENSE", "INCOME"] }, occurredAt: { gte: range.from, lt: range.to }, AND: [NOT_TRANSIT, NOT_PEER_OUT, { NOT: PEER_IN_WHERE }] },
          _sum: { amount: true },
        }),
        peerSums(user.id, { gte: range.from, lt: range.to }),
      ]);
      const sum = (kind: string) => fromDb(sums.find(s => s.kind === kind)?._sum.amount);
      const net = netPeer(peer.out, peer.in);
      return { ...m, expense: sum("EXPENSE") + net.expense, income: sum("INCOME") + net.income, peer };
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
    prisma.debt.findMany({ where: { userId: user.id, settledAt: null }, orderBy: { dueOn: "asc" } }),
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

  lines.push("", "ДОХОДЫ И РАСХОДЫ ПО МЕСЯЦАМ");
  lines.push("Переводы между своими счетами не учтены. Через счета пользователя друзья часто «прогоняют» деньги (пришло — отправил дальше частями, снял и отдал наличными или оплатил), поэтому переводы людям и снятие наличных считаются по сальдо: в расходах только то, что ушло сверх пришедшего от людей, в доходах — наоборот. Покупки всегда считаются расходами.");
  for (const m of monthly) {
    const current = m.year === year && m.month === month;
    lines.push(`• ${monthName(m.month)} ${m.year}${current ? ` (текущий, ${day} дн.)` : ""}: расходы ${money(m.expense)}, доходы ${money(m.income)} (от людей пришло ${money(m.peer.in)}, людям и наличными ушло ${money(m.peer.out)})`);
  }

  // Переводы людям и наличные по категориям не показываем — они выше, по сальдо
  const categories = limits.filter(c => c.name !== "Переводы людям" && c.name !== "Снятие наличных" && (c.spent > 0 || c.averageSpent > 0 || c.limit !== null)).sort((a, b) => b.spent - a.spent);
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

  if (debts.length > 0) {
    // Долги людям не проходят по счетам, пока их не вернули — модель должна знать о них отдельно
    lines.push("", "ДОЛГИ ЛЮДЯМ (не банковские, деньги ещё не возвращены)");
    for (const d of debts) {
      const side = d.direction === "OUT" ? "я должен" : "мне должны";
      lines.push(`• ${d.person}: ${side} ${money(fromDb(d.amount))}${d.dueOn ? `, вернуть до ${formatDayKey(d.dueOn)}` : ", срок не назначен"}${d.note ? ` (${d.note})` : ""}`);
    }
    const owe = debts.filter(d => d.direction === "OUT").reduce((s, d) => s + fromDb(d.amount), 0);
    const owed = debts.filter(d => d.direction === "IN").reduce((s, d) => s + fromDb(d.amount), 0);
    lines.push(`Итого: я должен ${money(owe)}, мне должны ${money(owed)}.`);
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
  | { ok: false; reason: "unavailable" | "daily_limit" | "failed" | "pro_only" };

type PreparedTurn =
  | { ok: true; text: string; context: string; history: AdvisorTurn[] }
  | { ok: false; reason: Exclude<AdvisorAnswer, { ok: true }>["reason"] };

/** Общая часть вопроса и потокового ответа: проверки, суточный лимит, история переписки и сводка */
async function prepareAdvisorTurn(user: AdvisorUser, question: string): Promise<PreparedTurn> {
  const text = question.trim().slice(0, 1000);
  if (!isAiConfigured()) return { ok: false, reason: "unavailable" };
  if (!planState(user).pro) return { ok: false, reason: "pro_only" };

  const today = dayKeyOf(new Date(), user.timezone);
  const [askedToday, recent] = await Promise.all([
    prisma.advisorMessage.count({ where: { userId: user.id, role: "user", createdAt: { gte: startOfDayInstant(today, user.timezone) } } }),
    prisma.advisorMessage.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - HISTORY_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    }),
  ]);
  if (askedToday >= (isOwner(user.telegramId) ? OWNER_DAILY_QUESTIONS : GUEST_DAILY_QUESTIONS)) return { ok: false, reason: "daily_limit" };

  const history: AdvisorTurn[] = recent.reverse().map(m => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text }));
  // Переписка должна начинаться с вопроса пользователя
  while (history[0]?.role === "assistant") history.shift();

  const context = await buildAdvisorContext(user);
  return { ok: true, text, context, history };
}

function saveAdvisorTurn(userId: string, question: string, answer: string, source: "BOT" | "APP") {
  return prisma.advisorMessage.createMany({
    data: [
      { userId, role: "user", text: question, source },
      { userId, role: "assistant", text: answer.slice(0, 8000), source },
    ],
  });
}

/** Вопрос советнику: сохраняется в общую переписку бота и приложения */
export async function askAdvisor(user: AdvisorUser, question: string, source: "BOT" | "APP"): Promise<AdvisorAnswer> {
  const prepared = await prepareAdvisorTurn(user, question);
  if (!prepared.ok) return prepared;
  try {
    const answer = await askAdvisorAi(prepared.context, prepared.history, prepared.text);
    if (!answer) return { ok: false, reason: "failed" };
    await saveAdvisorTurn(user.id, prepared.text, answer, source);
    return { ok: true, answer };
  } catch (error) {
    console.error("Advisor failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, reason: "failed" };
  }
}

/**
 * То же самое потоком — для «печатает на глазах» в боте.
 * `onText` получает накопленный текст по мере поступления; `shouldStop` проверяется между кусками.
 * При остановке частичный ответ всё равно сохраняется (с пометкой), чтобы не потерять контекст переписки.
 */
export async function streamAdvisor(
  user: AdvisorUser,
  question: string,
  source: "BOT" | "APP",
  options: { onText: (full: string) => void | Promise<void>; shouldStop?: () => Promise<boolean> },
): Promise<AdvisorAnswer & { stopped?: boolean }> {
  const prepared = await prepareAdvisorTurn(user, question);
  if (!prepared.ok) return prepared;

  const controller = new AbortController();
  let full = "";
  let stopped = false;
  try {
    for await (const chunk of streamAdvisorAi(prepared.context, prepared.history, prepared.text, controller.signal)) {
      full = chunk;
      await options.onText(full);
      if (options.shouldStop && (await options.shouldStop())) {
        stopped = true;
        controller.abort();
        break;
      }
    }
    if (!full) return { ok: false, reason: "failed" };
    await saveAdvisorTurn(user.id, prepared.text, stopped ? `${full}…` : full, source);
    return { ok: true, answer: full, stopped };
  } catch (error) {
    if (full) {
      // Хоть что-то получили до сбоя связи — не терять ответ
      await saveAdvisorTurn(user.id, prepared.text, `${full}…`, source);
      return { ok: true, answer: full, stopped: true };
    }
    console.error("Advisor stream failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, reason: "failed" };
  }
}

export async function getAdvisorHistory(userId: string, take = 40) {
  const messages = await prisma.advisorMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  return messages.reverse().map(m => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text }));
}

export const ADVISOR_ERRORS: Record<Exclude<AdvisorAnswer, { ok: true }>["reason"], string> = {
  unavailable: "Советник сейчас недоступен.",
  daily_limit: "На сегодня вопросы советнику закончились — продолжим завтра.",
  failed: "Советник не успел ответить. Спросите ещё раз через минуту.",
  pro_only: "✨ Советник входит в Pro.\nПодключить — /subscribe или «Настройки» → «Подписка» в приложении.",
};
