import { describe, expect, it } from "vitest";
import { allocateGoalSavings, goalReserve, incomesUntil, planGoal, previousIncomeDate, summarizeGoals } from "./goals";
import { simulatePayoff, simulateStrategy } from "./payoff";
import { calculateBudget } from "./budget";

describe("goals", () => {
  it("fills goals in order from the savings balance", () => {
    const goals = [
      { id: "a", targetAmount: 100_000_00, targetDate: null },
      { id: "b", targetAmount: 50_000_00, targetDate: null },
    ];
    expect(allocateGoalSavings(120_000_00, goals)).toEqual([
      { id: "a", saved: 100_000_00, remaining: 0, percent: 100 },
      { id: "b", saved: 20_000_00, remaining: 30_000_00, percent: 40 },
    ]);
    expect(allocateGoalSavings(-5, goals)[0].saved).toBe(0);
  });

  it("finds previous income date and counts incomes until a deadline", () => {
    expect(previousIncomeDate("2026-09-15", [25])).toBe("2026-08-25");
    expect(previousIncomeDate("2026-09-25", [25])).toBe("2026-09-25");
    expect(previousIncomeDate("2026-09-15", [])).toBe("2026-09-01");
    // 25 сент., 25 окт., 25 нояб., 25 дек.
    expect(incomesUntil("2026-09-15", "2026-12-31", [25])).toBe(4);
    expect(incomesUntil("2026-09-15", "2026-09-20", [25])).toBe(0);
  });

  it("plans contributions per income, including the current period", () => {
    expect(planGoal(500_000_00, "2026-09-15", "2026-12-31", [25])).toMatchObject({ perIncome: 100_000_00, incomesLeft: 4, status: "on_track" });
    expect(planGoal(0, "2026-09-15", "2026-12-31", [25]).status).toBe("done");
    expect(planGoal(100, "2026-09-15", null, [25]).status).toBe("no_deadline");
    expect(planGoal(100_00, "2026-09-15", "2026-09-01", [25])).toMatchObject({ status: "overdue", perIncome: 100_00 });
  });

  it("subtracts transfers already made this period", () => {
    expect(goalReserve(100_000_00, 30_000_00)).toBe(70_000_00);
    expect(goalReserve(100_000_00, 150_000_00)).toBe(0);
  });

  it("summarizes goals and counts transfers made this period toward the plan", () => {
    const goals = [{ id: "g", accountId: "dep", title: "Депозит", emoji: "🎯", targetAmount: 500_000_00, targetDate: "2026-12-31" }];
    const base = { goals, today: "2026-09-15", incomeDays: [25] };
    const before = summarizeGoals({ ...base, balances: new Map([["dep", 0]]), periodInflow: new Map() });
    expect(before.reserve).toBe(100_000_00);
    expect(before.items[0]).toMatchObject({ saved: 0, plannedThisPeriod: 100_000_00 });

    const after = summarizeGoals({ ...base, balances: new Map([["dep", 30_000_00]]), periodInflow: new Map([["dep", 30_000_00]]) });
    expect(after.reserve).toBe(70_000_00);
    expect(after.items[0]).toMatchObject({ saved: 30_000_00, plannedThisPeriod: 100_000_00 });

    const overdue = summarizeGoals({ ...base, goals: [{ ...goals[0], targetDate: "2026-09-01" }], balances: new Map(), periodInflow: new Map() });
    expect(overdue.reserve).toBe(0);
  });

  it("goal reserve lowers the daily limit", () => {
    const base = { today: "2026-09-15", horizon: "2026-09-25", balance: 200_000_00, cushion: 0, spentToday: 0, pendingPayments: [] };
    const withoutGoals = calculateBudget(base);
    const withGoals = calculateBudget({ ...base, goalReserve: 50_000_00 });
    expect(withGoals.reservedForGoals).toBe(50_000_00);
    expect(withGoals.reserved).toBe(50_000_00);
    expect(withGoals.dailyLimit).toBe(withoutGoals.dailyLimit - 5_000_00);
  });
});

describe("payoff", () => {
  it("simulates a loan with and without extra payments", () => {
    // 1 000 000 ₸ под 24% годовых, платёж 50 000 ₸
    const base = simulatePayoff(1_000_000_00, 24, 50_000_00);
    expect(base.feasible).toBe(true);
    expect(base.months).toBe(26);
    const extra = simulatePayoff(1_000_000_00, 24, 50_000_00, 25_000_00);
    expect(extra.months).toBeLessThan(base.months);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  it("handles zero-rate installments and lump sums", () => {
    expect(simulatePayoff(300_000_00, 0, 50_000_00)).toMatchObject({ months: 6, totalInterest: 0 });
    expect(simulatePayoff(300_000_00, 0, 50_000_00, 0, 100_000_00).months).toBe(4);
  });

  it("detects payments that do not cover interest", () => {
    expect(simulatePayoff(1_000_000_00, 36, 20_000_00).feasible).toBe(false);
  });

  it("avalanche pays less interest, snowball closes the small debt first", () => {
    const debts = [
      { id: "card", title: "Кредитка", balance: 300_000_00, ratePercent: 40, minPayment: 15_000_00 },
      { id: "small", title: "Рассрочка", balance: 60_000_00, ratePercent: 0, minPayment: 10_000_00 },
      { id: "loan", title: "Кредит", balance: 800_000_00, ratePercent: 20, minPayment: 40_000_00 },
    ];
    const avalanche = simulateStrategy(debts, 30_000_00, "avalanche");
    const snowball = simulateStrategy(debts, 30_000_00, "snowball");
    expect(avalanche.feasible && snowball.feasible).toBe(true);
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
    expect(snowball.order[0].id).toBe("small");
    expect(avalanche.order.map(o => o.id)).toContain("card");
  });

  it("reports infeasible strategies", () => {
    const result = simulateStrategy([{ id: "x", title: "X", balance: 1_000_000_00, ratePercent: 60, minPayment: 10_000_00 }], 0, "avalanche");
    expect(result.feasible).toBe(false);
  });
});
