import { NextRequest, NextResponse } from "next/server";
import { InlineKeyboard } from "grammy";
import { findUserByApiKey } from "@/lib/server/api-key";
import { captureAudio, captureText } from "@/lib/server/capture";
import { buildReceipt } from "@/lib/server/receipt";
import { errorMessage, getBot, isBotConfigured } from "@/lib/server/bot";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

function text(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Приём операции из Apple Shortcuts (кнопка Action Button).
 * POST, Authorization: Bearer fc_…, тело — JSON {"text": "..."} или form-data с полем text или audio.
 * Ответ — обычный текст, его удобно показать действием «Показать результат».
 */
export async function POST(req: NextRequest) {
  const user = await findUserByApiKey(req.headers.get("authorization"));
  if (!user) return text("Неверный ключ. Создайте новый в настройках FinCopilot.", 401);

  const contentType = req.headers.get("content-type") ?? "";
  let result;

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (typeof body?.text !== "string") return text("Нет текста", 400);
    result = await captureText(user, body.text, "SHORTCUT");
  } else {
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    const input = form?.get("text");
    if (audio instanceof File && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) return text("Запись слишком длинная", 400);
      result = await captureAudio(user, Buffer.from(await audio.arrayBuffer()), audio.type || "audio/m4a", "SHORTCUT");
    } else if (typeof input === "string") {
      result = await captureText(user, input, "SHORTCUT");
    } else {
      return text("Нет текста или аудио", 400);
    }
  }

  if (!result.ok) {
    return text(result.reason === "rate_limited" ? "Слишком много запросов, подождите минуту" : "Не понял 🤔 Скажите, например: «такси тысяча пятьсот»", 422);
  }

  const receipt = await buildReceipt(user, result.transactionId, result.linkedPaymentTitle);
  if (!receipt) return text("Ошибка", 500);

  // Дублируем чек в Telegram — там можно поменять категорию или отменить
  if (isBotConfigured()) {
    try {
      const bot = await getBot();
      await bot.api.sendMessage(String(user.telegramId), receipt.html, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🏷 Категория", `k:${result.transactionId}`).text("↩️ Отменить", `u:${result.transactionId}`),
      });
    } catch (error) {
      console.error("Failed to send shortcut receipt:", errorMessage(error));
    }
  }

  return text(receipt.plain);
}
