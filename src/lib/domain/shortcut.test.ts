import { describe, expect, it } from "vitest";
import { pathText, shortcutLinks, ACTION_BUTTON_PATH, BACK_TAP_PATH } from "./shortcut";

describe("shortcutLinks", () => {
  it("принимает только настоящие iCloud-ссылки на команду", () => {
    expect(shortcutLinks({ SHORTCUT_ICLOUD_URL: "https://www.icloud.com/shortcuts/abc123" }).install)
      .toBe("https://www.icloud.com/shortcuts/abc123");
    expect(shortcutLinks({ SHORTCUT_ICLOUD_URL: "https://icloud.com/shortcuts/abc123" }).install)
      .toBe("https://icloud.com/shortcuts/abc123");
  });

  it("отклоняет пустое, чужое или неверно оформленное значение", () => {
    expect(shortcutLinks({}).install).toBeNull();
    expect(shortcutLinks({ SHORTCUT_ICLOUD_URL: "" }).install).toBeNull();
    expect(shortcutLinks({ SHORTCUT_ICLOUD_URL: "http://icloud.com/shortcuts/abc" }).install).toBeNull();
    expect(shortcutLinks({ SHORTCUT_ICLOUD_URL: "https://evil.com/shortcuts/abc" }).install).toBeNull();
  });

  it("голосовой вариант — отдельная переменная", () => {
    const links = shortcutLinks({
      SHORTCUT_ICLOUD_URL: "https://www.icloud.com/shortcuts/one",
      SHORTCUT_AUDIO_ICLOUD_URL: "https://www.icloud.com/shortcuts/two",
    });
    expect(links).toEqual({ install: "https://www.icloud.com/shortcuts/one", audio: "https://www.icloud.com/shortcuts/two" });
  });
});

describe("pathText", () => {
  it("склеивает шаги через стрелку", () => {
    expect(pathText(["A", "B", "C"])).toBe("A → B → C");
  });

  it("реальные пути настроек iOS непустые и оканчиваются названием команды", () => {
    expect(ACTION_BUTTON_PATH.at(-1)).toContain("FinCopilot");
    expect(BACK_TAP_PATH.at(-1)).toContain("FinCopilot");
    expect(BACK_TAP_PATH.length).toBeGreaterThan(ACTION_BUTTON_PATH.length);
  });
});
