import "server-only";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { prisma } from "./prisma";
import { upsertTelegramUser } from "./auth";
import { isTelegramUserAllowed } from "./telegram-auth";
import { captureAudio, captureText, type CaptureResult } from "./capture";
import { deleteTransaction } from "./ledger";
import { markPaymentPaid } from "./payments";
import { budgetLine, buildReceipt, escapeHtml } from "./receipt";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { addDays, dayKeyOf, relativeDays, daysBetween } from "@/lib/domain/dates";
import { formatLimitAlert, isMonday } from "@/lib/domain/digest";
import { buildEvening, buildLimitsMessage, buildMorning, buildWeekly } from "./digests";
import { evaluateCategoryLimit } from "./limits";

const MAX_VOICE_SECONDS = 60;

let botInstance: Bot | null = null;
let initPromise: Promise<void> | null = null;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isBotConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function getBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!botInstance) {
    botInstance = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    registerHandlers(botInstance);
  }
  initPromise ??= botInstance.init();
  await initPromise;
  return botInstance;
}

function appUrl() {
  const url = process.env.APP_URL;
  return url?.startsWith("https://") ? url : null;
}

function openAppKeyboard(label = "Открыть FinCopilot") {
  const url = appUrl();
  return url ? new InlineKeyboard().webApp(label, url) : undefined;
}

function receiptKeyboard(transactionId: string) {
  return new InlineKeyboard().text("🏷 Категория", `k:${transactionId}`).text("↩️ Отменить", `u:${transactionId}`);
}

async function userFromContext(ctx: Context) {
  if (!ctx.from) return null;
  if (!isTelegramUserAllowed(ctx.from.id)) {
    await ctx.reply("Это приватный бот.");
    return null;
  }
  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  return existing ?? upsertTelegramUser(ctx.from);
}

async function replyWithCapture(ctx: Context, user: { id: string; timezone: string; cushion: bigint }, result: CaptureResult) {
  if (!result.ok) {
    const text = {
      ai_unavailable: "Не понял сумму. Напишите, например: <code>кофе 1200</code>",
      rate_limited: "Слишком много сообщений подряд — подождите минуту.",
      not_understood: "Не получилось разобрать 🤔\nПопробуйте так: <code>такси 1500</code> или <code>+250000 зарплата</code>",
    }[result.reason];
    await ctx.reply(text, { parse_mode: "HTML" });
    return;
  }
  const receipt = await buildReceipt(user, result.transactionId, result.linkedPaymentTitle);
  if (!receipt) return;
  await ctx.reply(receipt.html, { parse_mode: "HTML", reply_markup: receiptKeyboard(result.transactionId) });
}

function registerHandlers(bot: Bot) {
  bot.command("start", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;

    const url = appUrl();
    if (url) {
      await ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: "web_app", text: "Финансы", web_app: { url } },
      }).catch(() => undefined);
    }

    await ctx.reply(
      [
        `Привет${user.firstName ? `, ${escapeHtml(user.firstName)}` : ""}! Я помогу держать финансы под контролем 👋`,
        "",
        "Просто пишите траты сообщением:",
        "<code>кофе 1200</code>",
        "<code>такси 2.5к</code>",
        "<code>+250000 зарплата</code>",
        "",
        "Или отправьте голосовое 🎙",
        "",
        "Каждое утро пришлю лимит на день, вечером — итоги дня, по понедельникам — итоги недели.",
        "",
        "/today — сколько можно потратить сегодня",
        "/week — траты за 7 дней",
        "/limits — лимиты по категориям",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: openAppKeyboard() }
    );
  });

  bot.command(["today", "budget"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const morning = await buildMorning(user);
    await ctx.reply(morning.text, { parse_mode: "HTML", reply_markup: morning.keyboard ?? openAppKeyboard("Подробнее") });
  });

  bot.command("week", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const today = dayKeyOf(new Date(), user.timezone);
    const weekly = await buildWeekly(user, { from: addDays(today, -6), to: today });
    await ctx.reply(weekly.text, { parse_mode: "HTML", reply_markup: openAppKeyboard("Аналитика") });
  });

  bot.command("limits", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.reply((await buildLimitsMessage(user)).text, { parse_mode: "HTML", reply_markup: openAppKeyboard("Настроить лимиты") });
  });

  bot.command("help", ctx => ctx.reply(
    "Пишите траты в свободной форме: <code>обед 2500</code>, <code>1 500 такси</code>. Доход — с плюсом: <code>+100000 аванс</code>.\nПод каждой записью есть кнопки, чтобы поменять категорию или отменить.\n\n/today — лимит на сегодня\n/week — траты за 7 дней\n/limits — лимиты по категориям\n\nУтренние и вечерние итоги включаются и выключаются в приложении: Настройки → Бюджет.",
    { parse_mode: "HTML" }
  ));

  bot.on("message:text", async ctx => {
    if (ctx.message.text.startsWith("/")) return;
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    await replyWithCapture(ctx, user, await captureText(user, ctx.message.text, "BOT_TEXT"));
  });

  bot.on("message:voice", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    if (ctx.message.voice.duration > MAX_VOICE_SECONDS) {
      await ctx.reply("Голосовое слишком длинное — хватит пары секунд: «такси тысяча пятьсот».");
      return;
    }
    await ctx.replyWithChatAction("typing").catch(() => undefined);

    const file = await ctx.getFile();
    const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) {
      await ctx.reply("Не удалось скачать голосовое, попробуйте ещё раз.");
      return;
    }
    const audio = Buffer.from(await response.arrayBuffer());
    const mimeType = ctx.message.voice.mime_type || "audio/ogg";
    await replyWithCapture(ctx, user, await captureAudio(user, audio, mimeType, "BOT_VOICE"));
  });

  // ↩️ Отменить
  bot.callbackQuery(/^u:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const deleted = await deleteTransaction(user.id, ctx.match[1]);
    await ctx.answerCallbackQuery(deleted ? "Отменено" : "Уже удалено");
    if (deleted) {
      const amount = formatMoney(fromDb(deleted.amount));
      await ctx.editMessageText(`<s>${amount}${deleted.note ? ` · ${escapeHtml(deleted.note)}` : ""}</s>\n↩️ Запись отменена`, { parse_mode: "HTML" });
    }
  });

  // 🏷 Выбор категории
  bot.callbackQuery(/^k:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const tx = await prisma.transaction.findFirst({ where: { id: ctx.match[1], userId: user.id } });
    if (!tx) return ctx.answerCallbackQuery("Запись не найдена");

    const categories = await prisma.category.findMany({
      where: { userId: user.id, kind: tx.kind, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    const keyboard = new InlineKeyboard();
    categories.forEach((category, index) => {
      keyboard.text(`${category.emoji} ${category.name}`, `c:${tx.id}:${category.id}`);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text("← Назад", `b:${tx.id}`);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  bot.callbackQuery(/^c:(\w+):(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const [, transactionId, categoryId] = ctx.match;
    const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId: user.id } });
    const category = tx && await prisma.category.findFirst({ where: { id: categoryId, userId: user.id, kind: tx.kind } });
    if (!tx || !category) return ctx.answerCallbackQuery("Не получилось");

    await prisma.transaction.update({ where: { id: tx.id }, data: { categoryId: category.id } });
    const receipt = await buildReceipt(user, tx.id);
    await ctx.answerCallbackQuery(`${category.emoji} ${category.name}`);
    if (receipt) await ctx.editMessageText(receipt.html, { parse_mode: "HTML", reply_markup: receiptKeyboard(tx.id) });
  });

  bot.callbackQuery(/^b:(\w+)$/, async ctx => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: receiptKeyboard(ctx.match[1]) });
  });

  // ✅ Оплачено из утренних итогов: убираем только нажатую кнопку, текст итогов остаётся
  bot.callbackQuery(/^q:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const payment = await markPaymentPaid(user.id, ctx.match[1]);
    await ctx.answerCallbackQuery(payment ? `✅ ${payment.obligation.title} — оплачено` : "Уже оплачено");
    const rows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const remaining = rows
      .map(row => row.filter(button => !("callback_data" in button) || button.callback_data !== ctx.callbackQuery.data))
      .filter(row => row.length > 0);
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: remaining } }).catch(() => undefined);
  });

  // ✅ Оплачено (из отдельного напоминания)
  bot.callbackQuery(/^p:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const payment = await markPaymentPaid(user.id, ctx.match[1]);
    await ctx.answerCallbackQuery(payment ? "Отмечено" : "Уже оплачено");
    if (payment) {
      await ctx.editMessageText(
        `✅ <b>${escapeHtml(payment.obligation.title)}</b> — ${formatMoney(fromDb(payment.amount))} оплачено\n\n${await budgetLine(user)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  // Логируем только текст: объект ошибки grammY содержит контекст с токеном бота
  bot.catch(error => console.error("Bot error:", errorMessage(error.error)));
}

/**
 * Предупреждение о лимите категории для трат, внесённых в приложении
 * (в боте и быстрой команде оно показывается прямо в чеке).
 */
export async function notifyCategoryLimit(user: { id: string; timezone: string; telegramId: bigint }, categoryId: string | null, at: Date) {
  const result = await evaluateCategoryLimit(user, categoryId, at);
  if (!result?.newLevel || !isBotConfigured()) return;
  try {
    const bot = await getBot();
    await bot.api.sendMessage(String(user.telegramId), formatLimitAlert(result.line, result.newLevel), {
      parse_mode: "HTML",
      reply_markup: openAppKeyboard("Аналитика"),
    });
  } catch (error) {
    console.error("Limit alert failed:", errorMessage(error));
  }
}

type ScheduledUser = Awaited<ReturnType<typeof prisma.user.findMany>>[number];

/** Отдельные напоминания о платежах — для тех, кто выключил утренние итоги */
async function sendPaymentReminders(bot: Bot, user: ScheduledUser) {
  const today = dayKeyOf(new Date(), user.timezone);
  const payments = await prisma.scheduledPayment.findMany({
    where: { userId: user.id, status: "PENDING", remindedAt: null },
    include: { obligation: true },
    orderBy: { dueOn: "asc" },
  });
  let sent = 0;
  for (const payment of payments) {
    const diff = daysBetween(today, payment.dueOn);
    if (diff > 2) continue;
    const text = `${diff < 0 ? "⚠️" : "🔔"} <b>${escapeHtml(payment.obligation.title)}</b> — ${formatMoney(fromDb(payment.amount))}\nПлатёж ${relativeDays(diff)}`;
    await bot.api.sendMessage(String(user.telegramId), text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✅ Оплачено", `p:${payment.id}`),
    });
    await prisma.scheduledPayment.update({ where: { id: payment.id }, data: { remindedAt: new Date() } });
    sent++;
  }
  return sent;
}

/**
 * «Захват» отправки на сегодня: условное обновление даты последней отправки.
 * Если крон запустится повторно или параллельно, второй вызов ничего не отправит.
 */
async function claim(userId: string, field: "lastMorningOn" | "lastEveningOn" | "lastWeeklyOn", today: string, previous: string | null) {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ [field]: null }, { [field]: { not: today } }] },
    data: { [field]: today },
  });
  return { claimed: count > 0, release: () => prisma.user.update({ where: { id: userId }, data: { [field]: previous } }) };
}

/** Утренние (+ недельные по понедельникам) и вечерние итоги. Вызывается кроном. */
export async function sendScheduledDigests(slot: "morning" | "evening") {
  const bot = await getBot();
  const users = await prisma.user.findMany({ where: { onboardedAt: { not: null } } });
  const result = { sent: 0, failed: 0 };

  async function deliver(user: ScheduledUser, field: "lastMorningOn" | "lastEveningOn" | "lastWeeklyOn", build: () => Promise<{ text: string; keyboard?: InlineKeyboard }>, after?: () => Promise<unknown>) {
    const today = dayKeyOf(new Date(), user.timezone);
    const lock = await claim(user.id, field, today, user[field]);
    if (!lock.claimed) return;
    try {
      const message = await build();
      await bot.api.sendMessage(String(user.telegramId), message.text, {
        parse_mode: "HTML",
        reply_markup: message.keyboard ?? openAppKeyboard("Открыть FinCopilot"),
      });
      await after?.();
      result.sent++;
    } catch (error) {
      await lock.release();
      result.failed++;
      console.error(`Digest ${field} failed:`, errorMessage(error));
    }
  }

  for (const user of users) {
    const today = dayKeyOf(new Date(), user.timezone);
    if (slot === "morning") {
      if (user.morningDigest) {
        let paymentIds: string[] = [];
        await deliver(user, "lastMorningOn", async () => {
          const morning = await buildMorning(user);
          paymentIds = morning.paymentIds;
          return morning;
        }, () => prisma.scheduledPayment.updateMany({ where: { id: { in: paymentIds } }, data: { remindedAt: new Date() } }));
      } else if (user.remindersEnabled) {
        try {
          result.sent += await sendPaymentReminders(bot, user);
        } catch (error) {
          result.failed++;
          console.error("Reminders failed:", errorMessage(error));
        }
      }
      if (user.weeklyDigest && isMonday(today)) {
        await deliver(user, "lastWeeklyOn", () => buildWeekly(user));
      }
    } else if (user.eveningDigest) {
      await deliver(user, "lastEveningOn", () => buildEvening(user));
    }
  }
  return result;
}
