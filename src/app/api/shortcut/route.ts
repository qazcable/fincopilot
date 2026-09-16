import { NextRequest, NextResponse } from "next/server";
import { findUserByApiKey } from "@/lib/server/api-key";
import { runWithCurrency } from "@/lib/server/currency-context";
import { captureAudio, captureSms, captureText, captureWallet } from "@/lib/server/capture";
import { buildMultiReceipt, buildReceipt } from "@/lib/server/receipt";
import { errorMessage, getBot, isBotConfigured, sendReceipts } from "@/lib/server/bot";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

function text(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Приём операции из Apple Shortcuts (кнопка Action Button).
 * POST, Authorization: Bearer fc_…, тело — JSON {"text": "..."} или form-data с полем text или audio.
 * Автоматизации: {"amount", "merchant", "card"} — оплата Apple Wallet, {"sms": "..."} — SMS банка.
 * Ответ — обычный текст, его удобно показать действием «Показать результат».
 */
export async function POST(req: NextRequest) {
  const user = await findUserByApiKey(req.headers.get("authorization"));
  if (!user) return text("Неверный ключ. Создайте новый в настройках FinCopilot.", 401);
  // Суммы в ответе и чеках — в валюте пользователя
  return runWithCurrency(user.currency, () => handle(req, user));
}

async function handle(req: NextRequest, user: NonNullable<Awaited<ReturnType<typeof findUserByApiKey>>>) {
  const contentType = req.headers.get("content-type") ?? "";
  let result;
  // Что именно прислала быстрая команда — видно в логах, если разбор не удался
  let incoming = "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (typeof body?.sms === "string") {
      // Автоматизация «Сообщение»: SMS банка
      result = await captureSms(user, body.sms);
    } else if (body?.amount !== undefined && body?.amount !== null) {
      // Автоматизация «Транзакция» Apple Wallet: сумма, магазин, карта
      result = await captureWallet(user, {
        amount: String(body.amount),
        merchant: typeof body.merchant === "string" ? body.merchant : undefined,
        card: typeof body.card === "string" ? body.card : undefined,
      });
    } else if (typeof body?.text === "string") {
      incoming = `json text (${body.text.length})`;
      if (!body.text.trim()) return text("Пустой текст. Проверьте в команде порядок действий: «Диктовать текст» должно стоять выше «Получить содержимое URL»", 422);
      result = await captureText(user, body.text, "SHORTCUT");
    } else {
      console.log("shortcut: json without text", Object.keys(body ?? {}).join(","));
      return text("Нет текста", 400);
    }
  } else {
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    const input = form?.get("text");
    if (audio instanceof File && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) return text("Запись слишком длинная", 400);
      incoming = `audio ${audio.type || "?"} (${audio.size} б)`;
      result = await captureAudio(user, Buffer.from(await audio.arrayBuffer()), audio.type || "audio/m4a", "SHORTCUT");
    } else if (typeof input === "string") {
      incoming = `form text (${input.length})`;
      if (!input.trim()) return text("Пустой текст. Проверьте в команде порядок действий: «Диктовать текст» должно стоять выше «Получить содержимое URL»", 422);
      result = await captureText(user, input, "SHORTCUT");
    } else {
      console.log("shortcut: form without text/audio", [...(form?.keys() ?? [])].join(","), contentType);
      return text("Нет текста или аудио", 400);
    }
  }

  if (!result.ok) {
    const messages: Record<string, [string, number]> = {
      rate_limited: ["Слишком много запросов, подождите минуту", 429],
      duplicate: ["Эта оплата уже записана", 200],
      foreign_currency: ["Покупка в валюте — запишется из выписки банка", 200],
      bad_amount: ["Не понял сумму оплаты", 422],
    };
    const fallback: [string, number] = result.reason === "ai_unavailable"
      ? ["ИИ сейчас недоступен — попробуйте позже", 503]
      : incoming.startsWith("audio")
        ? ["Не разобрал запись 🎙 Назовите трату так: «такси тысяча пятьсот»", 422]
        : ["Не понял 🤔 Скажите, например: «такси тысяча пятьсот»", 422];
    const [message, status] = messages[result.reason] ?? fallback;
    console.log("shortcut failed:", result.reason, incoming);
    return text(message, status);
  }

  // Уведомление на iPhone: одна операция — чек, несколько — сводка списком
  const items = result.items;
  const receipt = items.length === 1
    ? await buildReceipt(user, items[0].transactionId, items[0].linkedPaymentTitle)
    : await buildMultiReceipt(user, items.map(i => i.transactionId));
  if (!receipt) return text("Ошибка", 500);

  // Дублируем чеки в Telegram — там можно поменять категорию или отменить
  if (isBotConfigured()) {
    try {
      const bot = await getBot();
      await sendReceipts(bot.api, String(user.telegramId), user, items);
    } catch (error) {
      console.error("Failed to send shortcut receipt:", errorMessage(error));
    }
  }

  return text(receipt.plain);
}
