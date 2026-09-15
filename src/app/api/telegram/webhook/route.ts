import { NextRequest, NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { errorMessage, getBot } from "@/lib/server/bot";

// Импорт годовой выписки с подбором категорий через ИИ может занимать больше минуты
export const maxDuration = 300;

function secretMatches(received: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update.update_id !== "number") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Отвечаем Telegram сразу, а разбор (включая ИИ) выполняем после ответа —
  // иначе долгий запрос к Gemini приводит к повторной доставке апдейта.
  after(async () => {
    try {
      const bot = await getBot();
      await bot.handleUpdate(update);
    } catch (error) {
      console.error("Failed to handle update:", errorMessage(error));
    }
  });

  return NextResponse.json({ ok: true });
}
