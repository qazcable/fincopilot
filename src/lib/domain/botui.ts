// Дизайн сообщений бота: единые приёмы оформления и тексты нижней клавиатуры.
// Правила: одна эмодзи в начале сообщения, главное число — жирным отдельной строкой, длинное — в сворачиваемой цитате.

/** Заголовок сообщения */
export const h = (html: string) => `<b>${html}</b>`;

/** Второстепенная строка */
export const muted = (html: string) => `<i>${html}</i>`;

export const quote = (html: string) => `<blockquote>${html}</blockquote>`;

/** Длинный блок, который Telegram показывает свёрнутым */
export const expandable = (html: string) => `<blockquote expandable>${html}</blockquote>`;

/** Склеивает строки сообщения, пропуская пустые значения (пустая строка — абзац) */
export function lines(...parts: (string | null | undefined | false)[]) {
  return parts.filter((part): part is string => typeof part === "string").join("\n");
}

/** Кнопки нижней клавиатуры бота */
export const KB = {
  today: "💸 Сегодня",
  week: "📊 Неделя",
  record: "🎙 Записать",
  ask: "💬 Спросить",
} as const;

// Старые подписи добавляются сюда при смене текста — у людей клавиатура остаётся прежней до следующего /start
const KB_ALIASES = new Set<string>(Object.values(KB));

/** Текст пришёл с кнопки нижней клавиатуры — это не трата и не вопрос */
export function isKeyboardText(text: string) {
  return KB_ALIASES.has(text.trim());
}

/** Эффекты сообщений Telegram (только личные чаты) */
export const EFFECT = {
  confetti: "5046509860389126442",
  fire: "5104841245755180586",
  like: "5107584321108051014",
  heart: "5159385139981059251",
} as const;

export type EffectName = keyof typeof EFFECT;

export const RECORD_HINT_HTML = lines(
  "🎙 Зажмите микрофон справа и скажите, например:",
  muted("«кофе 1200, такси 1500»") + " — запишу обе траты.",
  "",
  "Можно и текстом: <code>обед 2500</code>",
  "Доход — с плюсом: <code>+250000 зарплата</code>",
);

export const ASK_HINT_HTML = lines(
  "💬 Спросите что угодно о своих деньгах — просто напишите вопрос.",
  muted("Или выберите готовый:"),
);

export const STRANGER_HTML = lines(
  "🔒 " + h("FinCopilot — закрытая бета"),
  "Вход только по личному приглашению.",
  "Если вас пригласили — откройте ссылку-приглашение ещё раз.",
);
