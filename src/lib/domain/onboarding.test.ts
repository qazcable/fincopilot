import { describe, expect, it } from "vitest";
import { parseBalanceInput, parseDay } from "./onboarding";

describe("parseBalanceInput", () => {
  it("понимает суммы, как их пишут", () => {
    expect(parseBalanceInput("185 000")).toBe(18_500_000);
    expect(parseBalanceInput("185000 ₸")).toBe(18_500_000);
    expect(parseBalanceInput("50 тыс")).toBe(5_000_000);
    expect(parseBalanceInput("12,50 тг")).toBe(1_250);
  });

  it("ноль — допустимый ответ", () => {
    expect(parseBalanceInput("0")).toBe(0);
    expect(parseBalanceInput("0 ₸")).toBe(0);
  });

  it("мусор не принимается", () => {
    expect(parseBalanceInput("много")).toBeNull();
    expect(parseBalanceInput("")).toBeNull();
  });
});

describe("parseDay", () => {
  it("число месяца", () => {
    expect(parseDay("15")).toBe(15);
    expect(parseDay("5-е")).toBe(5);
    expect(parseDay("10 число")).toBeNull();
    expect(parseDay("10число")).toBe(10);
  });

  it("вне диапазона — нет", () => {
    expect(parseDay("0")).toBeNull();
    expect(parseDay("32")).toBeNull();
  });
});
