import "server-only";
import { InlineKeyboard } from "grammy";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { getMonthLimitLines } from "./limits";
import { addDays, dayKeyOf, daysBetween, formatDayKey, parseKey, startOfDayInstant, type DayKey } from "@/lib/domain/dates";
import { getForecast } from "./forecast";
import { forecastHeadline } from "@/lib/domain/forecast";
import { NOT_PEER_OUT, NOT_TRANSIT, PEER_IN_WHERE, netPeer } from "@/lib/domain/constants";
import { peerSums } from "./peer";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { formatEvening, formatLimits, formatMorning, formatWeekly, previousWeek, type CategoryAmount } from "@/lib/domain/digest";

type DigestUser = { id: string; timezone: string; cushion: bigint };

export type BotMessage = { text: string; keyboard?: InlineKeyboard };

const REMINDER_DAYS = 2;

async function categoryTotals(user: DigestUser, from: DayKey, toExclusive: DayKey, options: { excludePayments?: boolean } = {}) {
  const range = { gte: startOfDayInstant(from, user.timezone), lt: startOfDayInstant(toExclusive, user.timezone) };
  const [byCategory, income, peer] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { userId: user.id, kind: "EXPENSE", occurredAt: range, AND: [NOT_TRANSIT, NOT_PEER_OUT], ...(options.excludePayments ? { scheduledPaymentId: null } : {}) },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({ where: { userId: user.id, kind: "INCOME", occurredAt: range, AND: [NOT_TRANSIT, { NOT: PEER_IN_WHERE }] }, _sum: { amount: true } }),
    peerSums(user.id, range),
  ]);
  const net = netPeer(peer.out, peer.in);

  const categories = await prisma.category.findMany({
    where: { id: { in: byCategory.map(r => r.categoryId).filter((id): id is string => id !== null) } },
  });
  const items: CategoryAmount[] = byCategory
    .map(row => {
      const category = categories.find(c => c.id === row.categoryId);
      return { emoji: category?.emoji ?? "💸", name: category?.name ?? "Без категории", amount: fromDb(row._sum.amount) };
    })
    .sort((a, b) => b.amount - a.amount);
  // Переводы людям и наличные — только сальдо сверх пришедшего от людей
  if (net.expense > 0) {
    items.push({ emoji: "💸", name: "Переводы и наличные (сальдо)", amount: net.expense });
    items.sort((a, b) => b.amount - a.amount);
  }

  return { items, expense: items.reduce((sum, c) => sum + c.amount, 0), income: fromDb(income._sum.amount) + net.income };
}

/** Утро: лимит на день, платежи в ближайшие 2 дня (с кнопками «Оплачено») и предупреждения лимитов */
export async function buildMorning(user: DigestUser): Promise<BotMessage & { paymentIds: string[] }> {
  const snapshot = await getBudgetSnapshot(user);
  const { year, month } = parseKey(snapshot.today);
  const due = snapshot.pendingPayments.filter(p => daysBetween(snapshot.today, p.dueOn) <= REMINDER_DAYS);

  let text = formatMorning({
    today: snapshot.today,
    horizon: snapshot.horizon,
    hasIncomeSchedule: snapshot.hasIncomeSchedule,
    budget: snapshot.budget,
    duePayments: due,
    limits: await getMonthLimitLines(user, year, month),
  });

  // Кассовый разрыв в ближайшую неделю — предупреждаем заранее
  const forecast = await getForecast(user, 14);
  if (forecast.gapStart && forecast.gapStart <= addDays(snapshot.today, 7)) {
    const headline = forecastHeadline(forecast, snapshot.today, formatMoney, day => formatDayKey(day, snapshot.today).toLowerCase());
    text += `\n\n⚠️ <b>${headline.title}</b>\n${headline.text}`;
  }

  const keyboard = new InlineKeyboard();
  for (const payment of due) keyboard.text(`✅ ${payment.title} — ${formatMoney(payment.amount)}`, `q:${payment.id}`).row();
  return { text, keyboard: due.length ? keyboard : undefined, paymentIds: due.map(p => p.id) };
}

export async function buildEvening(user: DigestUser): Promise<BotMessage> {
  const snapshot = await getBudgetSnapshot(user);
  const totals = await categoryTotals(user, snapshot.today, addDays(snapshot.today, 1), { excludePayments: true });
  return {
    text: formatEvening({
      today: snapshot.today,
      horizon: snapshot.horizon,
      budget: snapshot.budget,
      spentToday: snapshot.spentToday,
      incomeToday: totals.income,
      topCategories: totals.items.slice(0, 3),
      tomorrowLimit: snapshot.tomorrowLimit,
    }),
  };
}

/** Итоги за период [from, to]; по умолчанию — прошлая неделя */
export async function buildWeekly(user: DigestUser, period?: { from: DayKey; to: DayKey }): Promise<BotMessage> {
  const { from, to } = period ?? previousWeek(dayKeyOf(new Date(), user.timezone));
  const length = daysBetween(from, to) + 1;

  const [current, previous] = await Promise.all([
    categoryTotals(user, from, addDays(to, 1)),
    categoryTotals(user, addDays(from, -length), from),
  ]);
  const { year, month } = parseKey(to);

  return {
    text: formatWeekly({
      from,
      to,
      expense: current.expense,
      previousExpense: previous.expense,
      income: current.income,
      categories: current.items,
      limits: await getMonthLimitLines(user, year, month),
    }),
  };
}

export async function buildLimitsMessage(user: DigestUser): Promise<BotMessage> {
  const { year, month } = parseKey(dayKeyOf(new Date(), user.timezone));
  return { text: formatLimits(await getMonthLimitLines(user, year, month)) };
}
