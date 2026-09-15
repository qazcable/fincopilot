import { describe, expect, it } from "vitest";
import { adviceSegments, adviceToTelegramHtml, looksLikeQuestion } from "./advisor";

describe("looksLikeQuestion", () => {
  it("detects questions and leaves expenses alone", () => {
    expect(looksLikeQuestion("сколько я потратил на кафе")).toBe(true);
    expect(looksLikeQuestion("Можно купить телефон за 300000?")).toBe(true);
    expect(looksLikeQuestion("Посоветуй, как экономить")).toBe(true);
    expect(looksLikeQuestion("кофе 1200")).toBe(false);
    expect(looksLikeQuestion("+250000 зарплата")).toBe(false);
    expect(looksLikeQuestion("такси 2.5к")).toBe(false);
    expect(looksLikeQuestion("?")).toBe(false);
  });
});

describe("advice formatting", () => {
  it("converts model markdown to Telegram HTML safely", () => {
    const html = adviceToTelegramHtml("## Итоги\n* Кафе **45 000 ₸** <много>\n- Такси");
    expect(html).toBe("<b>Итоги</b>\n• Кафе <b>45 000 ₸</b> &lt;много&gt;\n• Такси");
  });

  it("clips long answers", () => {
    expect(adviceToTelegramHtml("a".repeat(50), 10)).toBe("aaaaaaaaaa…");
  });

  it("splits bold segments for the app", () => {
    expect(adviceSegments("Траты **выросли** на 10%")).toEqual([
      { text: "Траты ", bold: false },
      { text: "выросли", bold: true },
      { text: " на 10%", bold: false },
    ]);
  });
});
