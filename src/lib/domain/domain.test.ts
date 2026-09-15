import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "./money";
import { addDays, clampedDay, daysBetween, dayKeyOf, localDateTimeToInstant, startOfDayInstant } from "./dates";
import { quickParse } from "./parse";
import { planPayments } from "./schedule";
import { calculateBudget, nextIncomeDate } from "./budget";

describe("money", () => {
  it("parses human input to minor units", () => {
    expect(parseAmount("1200")).toBe(120_000);
    expect(parseAmount("1 200")).toBe(120_000);
    expect(parseAmount("1200,5")).toBe(120_050);
    expect(parseAmount("2.5к")).toBe(250_000);
    expect(parseAmount("1,5 тыс")).toBe(150_000);
    expect(parseAmount("250 000")).toBe(25_000_000);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12 34")).toBeNull();
  });

  it("formats with non-breaking spaces", () => {
    expect(formatMoney(120_000)).toBe("1 200 ₸");
    expect(formatMoney(120_050)).toBe("1 200,50 ₸");
    expect(formatMoney(-5_000)).toBe("−50 ₸");
    expect(formatMoney(5_000, { sign: true })).toBe("+50 ₸");
  });
});

describe("dates", () => {
  it("does calendar math on day keys", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(daysBetween("2026-09-14", "2026-10-01")).toBe(17);
    expect(clampedDay(2026, 2, 31)).toBe("2026-02-28");
  });

  it("resolves local days in the user's time zone, not the server's", () => {
    // 20:30 UTC 14 сентября — это уже 15 сентября в Алматы (UTC+5)
    expect(dayKeyOf(new Date("2026-09-14T20:30:00Z"), "Asia/Almaty")).toBe("2026-09-15");
    expect(startOfDayInstant("2026-09-15", "Asia/Almaty").toISOString()).toBe("2026-09-14T19:00:00.000Z");
    expect(localDateTimeToInstant("2026-09-15T09:30", "Asia/Almaty")?.toISOString()).toBe("2026-09-15T04:30:00.000Z");
  });
});

describe("quickParse", () => {
  it("parses expense with amount at either side", () => {
    expect(quickParse("кофе 1200")).toEqual({ amount: 120_000, kind: "EXPENSE", note: "Кофе", categoryKey: "cafe" });
    expect(quickParse("1 500 такси до дома")).toMatchObject({ amount: 150_000, categoryKey: "transport", note: "Такси до дома" });
    expect(quickParse("обед 2.5к тг")).toMatchObject({ amount: 250_000, categoryKey: "cafe", note: "Обед" });
  });

  it("detects income", () => {
    expect(quickParse("+250 000 зарплата")).toMatchObject({ amount: 25_000_000, kind: "INCOME", categoryKey: "salary" });
    expect(quickParse("аванс 150000")).toMatchObject({ kind: "INCOME", categoryKey: "salary" });
  });

  it("leaves ambiguous input to AI", () => {
    expect(quickParse("2 кофе по 1200")).toBeNull();
    expect(quickParse("купил продукты")).toBeNull();
  });

  it("returns null category for unknown notes", () => {
    expect(quickParse("штука 700")).toMatchObject({ categoryKey: null });
    expect(quickParse("1300 на сигареты")).toMatchObject({ amount: 130_000, note: "Сигареты", categoryKey: "tobacco" });
    expect(quickParse("за интернет 7990")).toMatchObject({ note: "Интернет", categoryKey: "home" });
    expect(quickParse("стики 1500")).toMatchObject({ categoryKey: "tobacco" });
  });
});

describe("planPayments", () => {
  const base = { monthlyAmount: 25_000_00, dueDay: 20, startsOn: "2026-09-14" };

  it("generates monthly payments from start date up to horizon", () => {
    const planned = planPayments({ ...base, principalLeft: null }, [], "2026-11-30");
    expect(planned.map(p => p.dueOn)).toEqual(["2026-09-20", "2026-10-20", "2026-11-20"]);
  });

  it("skips a due day that already passed before start", () => {
    const planned = planPayments({ ...base, dueDay: 5, principalLeft: null }, [], "2026-10-31");
    expect(planned.map(p => p.dueOn)).toEqual(["2026-10-05"]);
  });

  it("caps amounts by remaining principal", () => {
    const planned = planPayments({ ...base, principalLeft: 60_000_00 }, [], "2027-03-01");
    expect(planned.map(p => p.amount)).toEqual([25_000_00, 25_000_00, 10_000_00]);
  });

  it("does not duplicate existing payments and accounts for pending ones", () => {
    const existing = [{ dueOn: "2026-09-20", amount: 25_000_00, status: "PENDING" }];
    const planned = planPayments({ ...base, principalLeft: 40_000_00 }, existing, "2026-12-31");
    expect(planned).toEqual([{ dueOn: "2026-10-20", amount: 15_000_00 }]);
  });

  it("keeps one payment per month when the due day changes", () => {
    const existing = [{ dueOn: "2026-09-20", amount: 25_000_00, status: "PAID" }];
    const planned = planPayments({ ...base, dueDay: 25, principalLeft: null }, existing, "2026-10-31");
    expect(planned.map(p => p.dueOn)).toEqual(["2026-10-25"]);
  });
});

describe("budget", () => {
  it("finds next income date strictly after today", () => {
    expect(nextIncomeDate("2026-09-14", [10, 25])).toBe("2026-09-25");
    expect(nextIncomeDate("2026-09-25", [10, 25])).toBe("2026-10-10");
    expect(nextIncomeDate("2026-09-14", [])).toBe("2026-10-01");
    expect(nextIncomeDate("2026-01-30", [31])).toBe("2026-01-31");
  });

  it("reserves payments before the horizon, including overdue ones", () => {
    const result = calculateBudget({
      today: "2026-09-14",
      horizon: "2026-09-25",
      balance: 200_000_00,
      cushion: 20_000_00,
      spentToday: 0,
      pendingPayments: [
        { dueOn: "2026-09-10", amount: 10_000_00 }, // просрочен
        { dueOn: "2026-09-20", amount: 25_000_00 },
        { dueOn: "2026-09-25", amount: 99_000_00 }, // в день зарплаты — уже после горизонта
      ],
    });
    expect(result.reserved).toBe(35_000_00);
    expect(result.free).toBe(145_000_00);
    expect(result.daysLeft).toBe(11);
    expect(result.dailyLimit).toBe(13_181_00);
    expect(result.status).toBe("good");
  });

  it("keeps the daily limit stable during the day", () => {
    const morning = calculateBudget({ today: "2026-09-14", horizon: "2026-09-24", balance: 100_000_00, cushion: 0, spentToday: 0, pendingPayments: [] });
    const evening = calculateBudget({ today: "2026-09-14", horizon: "2026-09-24", balance: 92_000_00, cushion: 0, spentToday: 8_000_00, pendingPayments: [] });
    expect(evening.dailyLimit).toBe(morning.dailyLimit);
    expect(evening.leftToday).toBe(2_000_00);
    expect(evening.status).toBe("tight");
  });

  it("reports overspending", () => {
    const result = calculateBudget({ today: "2026-09-14", horizon: "2026-09-20", balance: 10_000_00, cushion: 0, spentToday: 0, pendingPayments: [{ dueOn: "2026-09-15", amount: 30_000_00 }] });
    expect(result.status).toBe("over");
    expect(result.dailyLimit).toBe(0);
  });
});
