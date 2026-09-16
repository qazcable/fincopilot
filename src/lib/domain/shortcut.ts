// Быстрая команда iPhone: одни и те же шаги в приложении, боте и инструкции

export const SHORTCUT_NAME = "FinCopilot — записать";
export const SHORTCUT_AUDIO_NAME = "FinCopilot — голос";

/** Кнопка действия: iPhone 15 Pro и новее */
export const ACTION_BUTTON_PATH = ["Настройки", "Кнопка действия", "Команда", SHORTCUT_NAME];

/** Касание задней панели: iPhone 8 и новее, iOS 14+ */
export const BACK_TAP_PATH = ["Настройки", "Универсальный доступ", "Касание", "Касание задней панели", "Двойное касание", SHORTCUT_NAME];

export const pathText = (path: string[]) => path.join(" → ");

/** Ссылки установки задаются владельцем в переменных окружения после публикации команды в iCloud */
export function shortcutLinks(env: Record<string, string | undefined>) {
  const valid = (url: string | undefined) => (url && /^https:\/\/(www\.)?icloud\.com\/shortcuts\//.test(url) ? url : null);
  return { install: valid(env.SHORTCUT_ICLOUD_URL), audio: valid(env.SHORTCUT_AUDIO_ICLOUD_URL) };
}
