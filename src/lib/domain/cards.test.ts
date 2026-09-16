import { describe, expect, it } from "vitest";
import { cardHeight, fitCaption, goalCard, setupCard, weeklyCard } from "./cards";

describe("fitCaption", () => {
  it("короткий текст целиком идёт в подпись", () => {
    expect(fitCaption("<b>Итоги</b>\n\nвсё")).toEqual({ caption: "<b>Итоги</b>\n\nвсё", rest: null });
  });

  it("длинный текст: первый абзац — подпись, остальное — отдельным сообщением", () => {
    const html = `<b>Итоги</b>\nкоротко\n\n${"x".repeat(1100)}`;
    expect(fitCaption(html)).toEqual({ caption: "<b>Итоги</b>\nкоротко", rest: "x".repeat(1100) });
  });

  it("если и первый абзац длинный — подписи нет, всё текстом", () => {
    const html = "y".repeat(1100);
    expect(fitCaption(html)).toEqual({ caption: null, rest: html });
  });

  it("длина считается без HTML-тегов", () => {
    const html = `<b>${"z".repeat(1000)}</b>`;
    expect(fitCaption(html).caption).toBe(html);
  });
});

describe("карточки", () => {
  it("высота растёт вместе с содержимым", () => {
    const empty = weeklyCard({ from: "2026-09-07", to: "2026-09-13", expense: 0, previousExpense: 0, income: 0, categories: [], limits: [] });
    const full = weeklyCard({
      from: "2026-09-07", to: "2026-09-13", expense: 100_00, previousExpense: 50_00, income: 0, limits: [],
      categories: [{ emoji: "", name: "Кафе", amount: 100_00 }],
    });
    expect(cardHeight(full)).toBeGreaterThan(cardHeight(empty));
    expect(full.chips?.[0]).toEqual({ text: "+100% к прошлой неделе", tone: "negative" });
  });

  it("итог настройки и цель показывают значок", () => {
    expect(setupCard({ firstName: "Азамат", today: "2026-09-16", horizon: "2026-09-25", hasIncomeSchedule: true, leftToday: 100_00, daysLeft: 9, trial: true }).badge).toBe("check");
    expect(goalCard({ title: "Отпуск", amount: 1_000_00, days: 30 }).badge).toBe("trophy");
  });
});
