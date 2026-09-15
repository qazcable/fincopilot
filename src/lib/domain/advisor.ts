// ИИ-советник: распознавание вопросов и оформление ответа

const QUESTION_START = /^(сколько|как|почему|зачем|что\s|чем|можно ли|стоит ли|где|когда|куда|какой|какая|какое|какие|посоветуй|подскажи|помоги|проанализируй|разбери|анализ|совет|объясни|расскажи|хватит ли|успею ли|смогу ли|реально ли|правильно ли|нормально ли)/i;

/** Сообщение в бот — вопрос советнику, а не запись траты */
export function looksLikeQuestion(text: string) {
  const input = text.trim();
  if (input.length < 4) return false;
  return input.endsWith("?") || QUESTION_START.test(input);
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Упрощённый Markdown модели → строки с отметкой жирного текста */
export function normalizeAdvice(text: string) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line
      // Заголовки превращаем в жирную строку
      .replace(/^#{1,6}\s+(.+)$/, "**$1**")
      // Маркеры списков — единый вид
      .replace(/^\s*[*-]\s+/, "• ")
      .trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ответ для Telegram (HTML): **жирный** → <b>, остальное экранируется */
export function adviceToTelegramHtml(text: string, maxLength = 3800) {
  const normalized = normalizeAdvice(text);
  const clipped = normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}…` : normalized;
  return escapeHtml(clipped).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
}

/** Разбивка строки на обычные и жирные фрагменты — для приложения */
export function adviceSegments(line: string): { text: string; bold: boolean }[] {
  return line.split(/(\*\*.+?\*\*)/g).filter(Boolean).map(part =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? { text: part.slice(2, -2), bold: true }
      : { text: part.replace(/\*\*/g, ""), bold: false }
  );
}

export const ADVISOR_SUGGESTIONS = [
  "Разбери мои финансы за этот месяц",
  "На чём я могу сэкономить?",
  "Успею накопить на цель к сроку?",
  "Какой кредит гасить досрочно?",
];

export const ADVICE_REVIEW_PROMPT = "Сделай короткий разбор моих финансов за этот месяц: что идёт хорошо, что тревожит, и 3 конкретных совета с цифрами.";
