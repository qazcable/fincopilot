import { describe, expect, it } from "vitest";
import { expectedMonthlyIncome, forecastBalance, typicalDailySpend } from "./forecast";

describe("forecastBalance", () => {
  const base = {
    today: "2026-09-15",
    days: 20,
    balance: 50_000_00,
    dailySpend: 5_000_00,
    incomes: [{ title: "Зарплата", dayOfMonth: 25, amount: 400_000_00 }],
    payments: [{ title: "Кредит", dueOn: "2026-09-22", amount: 30_000_00 }],
  };

  it("finds the day the gap starts and the day salary closes it", () => {
    const result = forecastBalance(base);
    // 16..21 сент.: −30 000 → 20 000; 22 сент.: −5 000 − 30 000 → −15 000
    expect(result.gapStart).toBe("2026-09-22");
    expect(result.points.find(p => p.day === "2026-09-22")).toMatchObject({ balance: -15_000_00, events: [{ title: "Кредит", amount: -30_000_00, kind: "payment" }] });
    expect(result.minDay).toBe("2026-09-24");
    expect(result.minBalance).toBe(-25_000_00);
    expect(result.gapEnd).toBe("2026-09-25");
    expect(result.points).toHaveLength(21);
  });

  it("reports no gap when money is enough and handles overdue payments", () => {
    const result = forecastBalance({ ...base, balance: 200_000_00, payments: [{ title: "Счёт", dueOn: "2026-09-10", amount: 10_000_00 }] });
    expect(result.gapStart).toBeNull();
    expect(result.points[1].events).toHaveLength(1);
  });

  it("keeps the gap open if income is not expected", () => {
    const result = forecastBalance({ ...base, incomes: [] });
    expect(result.gapStart).toBe("2026-09-22");
    expect(result.gapEnd).toBeNull();
  });
});

describe("history estimates", () => {
  it("trims the largest days from typical spending", () => {
    // 10 дней: девять по 2 000 ₸ и один — оплата учёбы
    expect(typicalDailySpend([375_000_00, ...Array(9).fill(2_000_00)], 10)).toBe(2_000_00);
    expect(typicalDailySpend([3_000_00], 3)).toBe(1_000_00);
  });

  it("averages salary over months when it came", () => {
    expect(expectedMonthlyIncome([0, 350_000_00, 421_000_00])).toBe(385_500_00);
    expect(expectedMonthlyIncome([0, 0])).toBe(0);
  });
});
