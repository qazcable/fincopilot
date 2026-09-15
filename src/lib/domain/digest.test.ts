import { describe, expect, it } from "vitest";
import { limitProgress, reachedLevels } from "./limits";
import { formatEvening, formatLimitAlert, formatMorning, formatRange, formatWeekly, isMonday, previousWeek } from "./digest";
import { calculateBudget } from "./budget";

const NBSP = " ";
// В суммах разделители тысяч и пробел перед ₸ неразрывные
const money = (text: string) => text.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`).replace(/(\d) ₸/g, `$1${NBSP}₸`);

describe("limits", () => {
  it("computes progress and state", () => {
    expect(limitProgress(30_000_00, 40_000_00)).toMatchObject({ percent: 75, state: "ok", left: 10_000_00 });
    expect(limitProgress(34_000_00, 40_000_00)).toMatchObject({ percent: 85, state: "warn" });
    expect(limitProgress(40_000_00, 40_000_00)).toMatchObject({ percent: 100, state: "warn" });
    expect(limitProgress(42_000_00, 40_000_00)).toMatchObject({ percent: 105, state: "over", left: -2_000_00 });
  });

  it("reports reached thresholds", () => {
    expect(reachedLevels(31_999_00, 40_000_00)).toEqual([]);
    expect(reachedLevels(32_000_00, 40_000_00)).toEqual([80]);
    expect(reachedLevels(40_000_00, 40_000_00)).toEqual([80, 100]);
    expect(reachedLevels(10, 0)).toEqual([]);
  });
});

describe("weeks", () => {
  it("finds previous Monday–Sunday", () => {
    // 15 сентября 2026 — вторник
    expect(previousWeek("2026-09-15")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(previousWeek("2026-09-14")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(previousWeek("2026-09-13")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(isMonday("2026-09-14")).toBe(true);
    expect(isMonday("2026-09-15")).toBe(false);
  });

  it("formats ranges", () => {
    expect(formatRange("2026-09-07", "2026-09-13")).toBe("7–13 сентября");
    expect(formatRange("2026-08-31", "2026-09-06")).toBe("31 августа – 6 сентября");
  });
});

describe("digest texts", () => {
  const budget = calculateBudget({ today: "2026-09-15", horizon: "2026-09-25", balance: 150_000_00, cushion: 0, spentToday: 0, pendingPayments: [] });

  it("morning shows limit, payments and only limit warnings", () => {
    const text = formatMorning({
      today: "2026-09-15",
      horizon: "2026-09-25",
      hasIncomeSchedule: true,
      budget,
      duePayments: [{ title: "Рассрочка <iPhone>", amount: 30_000_00, dueOn: "2026-09-16" }],
      limits: [
        { emoji: "☕", name: "Кафе", spent: 34_000_00, limit: 40_000_00 },
        { emoji: "🛒", name: "Продукты", spent: 10_000_00, limit: 80_000_00 },
      ],
    });
    expect(text).toContain(money("Сегодня можно потратить <b>15 000 ₸</b>"));
    expect(text).toContain("10 дней до зарплаты 25 сентября");
    expect(text).toContain(money("Рассрочка &lt;iPhone&gt; — 30 000 ₸, завтра"));
    expect(text).toContain("☕ Кафе");
    expect(text).not.toContain("Продукты");
  });

  it("morning warns about shortfall", () => {
    const over = calculateBudget({ today: "2026-09-15", horizon: "2026-09-25", balance: 10_000_00, cushion: 0, spentToday: 0, pendingPayments: [{ dueOn: "2026-09-20", amount: 30_000_00 }] });
    const text = formatMorning({ today: "2026-09-15", horizon: "2026-09-25", hasIncomeSchedule: true, budget: over, duePayments: [], limits: [] });
    expect(text).toContain(money("не хватает <b>20 000 ₸</b>"));
  });

  it("evening summarises the day", () => {
    const text = formatEvening({
      today: "2026-09-15", horizon: "2026-09-25", budget, spentToday: 9_200_00, incomeToday: 0,
      topCategories: [{ emoji: "☕", name: "Кафе", amount: 5_000_00 }], tomorrowLimit: 15_600_00,
    });
    expect(text).toContain(money("Потрачено <b>9 200 ₸</b> из 15 000 ₸ ✅"));
    expect(text).toContain(money("Завтра можно будет <b>15 600 ₸</b>"));
  });

  it("evening handles overspending, empty day and payday", () => {
    expect(formatEvening({ today: "2026-09-15", horizon: "2026-09-25", budget, spentToday: 17_000_00, incomeToday: 0, topCategories: [], tomorrowLimit: 0 }))
      .toContain(money("на 2 000 ₸ больше лимита"));
    const empty = formatEvening({ today: "2026-09-24", horizon: "2026-09-25", budget, spentToday: 0, incomeToday: 0, topCategories: [], tomorrowLimit: 0 });
    expect(empty).toContain("трат не записано");
    expect(empty).toContain("Завтра зарплата");
  });

  it("weekly compares with previous week and lists categories", () => {
    const text = formatWeekly({
      from: "2026-09-07", to: "2026-09-13", expense: 84_000_00, previousExpense: 95_000_00, income: 0,
      categories: [{ emoji: "☕", name: "Кафе", amount: 42_000_00 }],
      limits: [{ emoji: "☕", name: "Кафе", spent: 42_000_00, limit: 40_000_00 }],
    });
    expect(text).toContain("Неделя 7–13 сентября");
    expect(text).toContain("−12% к прошлой");
    expect(text).toContain(money("В среднем в день: 12 000 ₸"));
    expect(text).toContain("· 50%");
    expect(text).toContain("🚫 ☕ Кафе");
  });

  it("limit alerts", () => {
    expect(formatLimitAlert({ emoji: "☕", name: "Кафе", spent: 34_000_00, limit: 40_000_00 }, 80)).toContain(money("осталось 6 000 ₸"));
    expect(formatLimitAlert({ emoji: "☕", name: "Кафе", spent: 41_000_00, limit: 40_000_00 }, 100)).toContain("исчерпан");
  });
});
