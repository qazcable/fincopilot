/** Экранирование пользовательского текста для сообщений Telegram с parse_mode: "HTML" */
export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Убирает HTML-разметку — для простого текста (Apple Shortcuts) */
export function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
