import "server-only";
import { GrammyError, Keyboard, type Context } from "grammy";
import type { ReactionTypeEmoji } from "grammy/types";
import { EFFECT, KB, type EffectName } from "@/lib/domain/botui";

export * from "@/lib/domain/botui";

/** Нижняя клавиатура: всегда под рукой, «Сегодня» — главная кнопка */
export function mainKeyboard() {
  return new Keyboard()
    .text(KB.today).style("primary")
    .text(KB.week).row()
    .text(KB.record)
    .text(KB.ask)
    .resized()
    .persistent()
    .placeholder("Трата или вопрос: кофе 1200");
}

// Эффекты, которые Telegram отклонил в этом процессе, больше не пробуем
const rejectedEffects = new Set<string>();

function isEffectError(error: unknown) {
  return error instanceof GrammyError && error.error_code === 400 && /effect/i.test(error.description);
}

/**
 * Отправка с эффектом (конфетти и т. п.). Если Telegram не принял эффект —
 * сообщение уходит без него: праздник не должен ломать доставку.
 */
export async function withEffect<T>(name: EffectName, send: (extra: { message_effect_id?: string }) => Promise<T>): Promise<T> {
  const id = EFFECT[name];
  if (rejectedEffects.has(id)) return send({});
  try {
    return await send({ message_effect_id: id });
  } catch (error) {
    if (!isEffectError(error)) throw error;
    rejectedEffects.add(id);
    console.warn(`Message effect ${name} rejected, sending without it`);
    return send({});
  }
}

/** Реакция бота на сообщение пользователя; ошибки не мешают основному ответу */
export function react(ctx: Context, emoji: ReactionTypeEmoji["emoji"]) {
  if (!ctx.message) return Promise.resolve();
  return ctx.react(emoji).then(() => undefined, () => undefined);
}
