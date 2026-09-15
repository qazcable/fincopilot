import "server-only";
import { prisma } from "./prisma";
import { ownerTelegramIds } from "./access-rules";
import { escapeHtml } from "@/lib/domain/text";

type FeedbackAuthor = { id: string; telegramId: bigint; firstName: string | null; username: string | null };

export const FEEDBACK_PROMPT = "✍️ Напишите отзыв ответом на это сообщение";

export function authorLine(user: FeedbackAuthor) {
  const name = escapeHtml(user.firstName ?? "Без имени");
  return user.username ? `${name} (@${escapeHtml(user.username)})` : name;
}

/** Получатели отзывов — владельцы проекта, кроме самого автора */
export function feedbackRecipients(author: { telegramId: bigint }) {
  return ownerTelegramIds().filter(id => id !== String(author.telegramId));
}

/** Сохраняет отзыв и присылает его владельцам в Telegram */
export async function saveFeedback(user: FeedbackAuthor, text: string, source: "BOT" | "APP", page?: string | null) {
  const clean = text.trim().slice(0, 4000);
  if (!clean) return null;
  const feedback = await prisma.feedback.create({ data: { userId: user.id, text: clean, source, page: page?.slice(0, 100) ?? null } });

  const recipients = feedbackRecipients(user);
  if (recipients.length > 0 && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const { getBot } = await import("./bot");
      const bot = await getBot();
      const where = source === "APP" ? `приложение${page ? `, ${escapeHtml(page)}` : ""}` : "бот";
      for (const chatId of recipients) {
        await bot.api.sendMessage(chatId, `💬 <b>Отзыв</b> от ${authorLine(user)} · ${where}\n\n${escapeHtml(clean)}`, { parse_mode: "HTML" });
      }
    } catch (error) {
      console.error("Feedback notify failed:", error instanceof Error ? error.message : String(error));
    }
  }
  return feedback;
}
