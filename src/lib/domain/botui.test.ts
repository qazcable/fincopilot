import { describe, expect, it } from "vitest";
import { KB, expandable, isKeyboardText, lines } from "./botui";

describe("botui", () => {
  it("lines пропускает пустые значения, но сохраняет абзацы", () => {
    expect(lines("а", null, undefined, false, "", "б")).toBe("а\n\nб");
  });

  it("кнопки нижней клавиатуры не считаются тратой", () => {
    for (const label of Object.values(KB)) expect(isKeyboardText(label)).toBe(true);
    expect(isKeyboardText(` ${KB.today} `)).toBe(true);
    expect(isKeyboardText("кофе 1200")).toBe(false);
    expect(isKeyboardText("Сегодня 500")).toBe(false);
  });

  it("сворачиваемая цитата оформлена по правилам Telegram", () => {
    expect(expandable("текст")).toBe("<blockquote expandable>текст</blockquote>");
  });
});
