import "server-only";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { prisma } from "./prisma";
import { upsertTelegramUser } from "./auth";
import { hasAccess, isOwner, redeemInvite } from "./access";
import { FEEDBACK_PROMPT, authorLine, feedbackRecipients, saveFeedback } from "./feedback";
import { captureAudio, captureText, type CaptureResult, type CapturedItem } from "./capture";
import { deleteTransaction } from "./ledger";
import { markPaymentPaid } from "./payments";
import { budgetLine, buildMultiReceipt, buildReceipt, escapeHtml, siblingTransactionIds } from "./receipt";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { addDays, dayKeyOf, relativeDays, daysBetween } from "@/lib/domain/dates";
import { formatLimitAlert, isMonday } from "@/lib/domain/digest";
import { buildEvening, buildLimitsMessage, buildMorning, buildWeekly } from "./digests";
import { evaluateCategoryLimit } from "./limits";
import { applyImport, cancelImport, createStatementDraft, rememberMerchantCategory } from "./imports";
import { formatImportApplied, formatImportDraft, hasSomethingToImport } from "@/lib/domain/importText";
import { ADVISOR_ERRORS, askAdvisor } from "./advisor";
import { ADVICE_REVIEW_PROMPT, adviceToTelegramHtml, looksLikeQuestion } from "@/lib/domain/advisor";
import { GUIDE_INTRO_HTML, GUIDE_TOPICS, guideTopic, guideTopicHtml } from "@/lib/domain/guide";

const MAX_VOICE_SECONDS = 60;
// Ограничение Bot API на скачивание файлов
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

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
  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (existing && hasAccess(existing)) return existing;
  if (isOwner(ctx.from.id)) return existing ?? upsertTelegramUser(ctx.from);
  // Посторонних не заводим в базе — только ответ
  await ctx.reply("Это закрытый бот 🔒 Доступ — по приглашению. Попросите ссылку у того, кто вас позвал.");
  return null;
}

function guideMenuKeyboard() {
  const keyboard = new InlineKeyboard();
  GUIDE_TOPICS.forEach((topic, index) => {
    keyboard.text(`${topic.emoji} ${topic.title}`, `g:${topic.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

/** Отзыв: ответ на сообщение бота с приглашением написать отзыв */
function isFeedbackReply(ctx: Context) {
  const reply = ctx.message?.reply_to_message;
  return Boolean(reply?.from?.is_bot && reply.text?.startsWith(FEEDBACK_PROMPT));
}

async function acceptFeedback(ctx: Context, user: NonNullable<Awaited<ReturnType<typeof userFromContext>>>, text: string) {
  const message = ctx.message;
  await saveFeedback(user, text, "BOT");
  // Голос и скриншоты пересылаем владельцам как есть
  if (message && (message.voice || message.photo || message.document || message.video)) {
    for (const chatId of feedbackRecipients(user)) {
      await ctx.api.sendMessage(chatId, `📎 Вложение к отзыву от ${authorLine(user)}:`, { parse_mode: "HTML" }).catch(() => undefined);
      await ctx.api.copyMessage(chatId, message.chat.id, message.message_id).catch(() => undefined);
    }
  }
  await ctx.reply("Спасибо! 🙏 Отзыв получен — это правда помогает сделать FinCopilot лучше.");
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
  await sendReceipts(ctx.api, String(ctx.chat!.id), user, result.items);
}

type ReceiptUser = { id: string; timezone: string; cushion: bigint };

const shortLabel = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Одно сообщение со списком операций и кнопками под каждой строкой: категория и отмена */
async function multiReceiptView(user: ReceiptUser, transactionIds: string[]) {
  const summary = await buildMultiReceipt(user, transactionIds);
  const keyboard = new InlineKeyboard();
  summary.transactions.forEach((tx, index) => {
    keyboard.text(`🏷 ${index + 1}. ${shortLabel(tx.note || tx.category?.name || "Операция")}`, `mk:${tx.id}`).text("↩️", `mu:${tx.id}`).row();
  });
  return { html: summary.html, keyboard, count: summary.transactions.length };
}

/** Чеки операций: одна — обычный чек; несколько — одно сообщение со списком и кнопками для каждой строки */
export async function sendReceipts(api: Bot["api"], chatId: string, user: ReceiptUser, items: CapturedItem[]) {
  if (items.length === 1) {
    const receipt = await buildReceipt(user, items[0].transactionId, items[0].linkedPaymentTitle);
    if (receipt) await api.sendMessage(chatId, receipt.html, { parse_mode: "HTML", reply_markup: receiptKeyboard(items[0].transactionId) });
    return;
  }
  const view = await multiReceiptView(user, items.map(i => i.transactionId));
  await api.sendMessage(chatId, view.html, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function replyWithAdvice(ctx: Context, user: Parameters<typeof askAdvisor>[0], question: string) {
  await ctx.replyWithChatAction("typing").catch(() => undefined);
  // Ответ с размышлениями может занять десяток секунд — «печатает» гаснет через 5 с
  const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => undefined), 4500);
  try {
    const result = await askAdvisor(user, question, "BOT");
    const url = appUrl();
    await ctx.reply(result.ok ? `💬 ${adviceToTelegramHtml(result.answer)}` : ADVISOR_ERRORS[result.reason], {
      parse_mode: "HTML",
      reply_markup: url ? new InlineKeyboard().webApp("Продолжить в приложении", `${url}/advisor`) : undefined,
    });
  } finally {
    clearInterval(typing);
  }
}

function registerHandlers(bot: Bot) {
  bot.command("start", async ctx => {
    // Вход по приглашению: t.me/<бот>?start=inv_<code>
    const payload = ctx.match?.trim() ?? "";
    if (payload.startsWith("inv_")) {
      const result = await redeemInvite(payload.slice(4), ctx.from!);
      if (!result.ok) {
        await ctx.reply({
          invalid: "Приглашение не найдено 🤔 Попросите новую ссылку.",
          used: "Этой ссылкой уже воспользовались. Попросите новую — она одноразовая.",
          expired: "Срок приглашения истёк. Попросите новую ссылку.",
        }[result.reason]);
        return;
      }
      if (result.inviterTelegramId) {
        await ctx.api.sendMessage(String(result.inviterTelegramId), `🎉 ${authorLine(result.user)} принял(а) приглашение в FinCopilot`, { parse_mode: "HTML" }).catch(() => undefined);
      }
    }

    const user = await userFromContext(ctx);
    if (!user) return;

    const url = appUrl();
    if (url) {
      await ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: "web_app", text: "Финансы", web_app: { url } },
      }).catch(() => undefined);
    }

    const keyboard = new InlineKeyboard().text("📖 Как пользоваться — инструкция", "g:new").row();
    if (url) keyboard.webApp("💸 Открыть приложение", url);
    await ctx.reply(
      [
        `Привет${user.firstName ? `, ${escapeHtml(user.firstName)}` : ""}! Я FinCopilot — помогу держать финансы под контролем 👋`,
        "",
        "<b>Что я умею:</b>",
        "💸 Считаю, сколько можно потратить сегодня, чтобы хватило до зарплаты",
        "✍️ Записываю траты сообщением или голосом: <code>кофе 1200</code>",
        "🏦 Напоминаю о кредитах и платежах",
        "🎯 Помогаю копить к цели и вижу кассовые разрывы заранее",
        "🤖 Отвечаю на вопросы о ваших деньгах: <i>на чём сэкономить?</i>",
        "",
        "<b>С чего начать:</b>",
        "1. Откройте приложение и укажите, сколько денег на карте и когда зарплата.",
        "2. Добавьте кредиты и счета.",
        "3. Записывайте траты сюда, в чат.",
        "",
        "Подробно о каждой функции — в инструкции 👇",
        "🧪 Приложение в тестировании — идеи и замечания присылайте через /feedback",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  // Инструкция отдельным сообщением — приветствие остаётся в чате
  bot.callbackQuery("g:new", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(GUIDE_INTRO_HTML, { parse_mode: "HTML", reply_markup: guideMenuKeyboard() });
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
    "📖 Подробная инструкция по каждой функции — /guide\n\n" +
    "Пишите траты в свободной форме: <code>обед 2500</code>, <code>1 500 такси</code>. Доход — с плюсом: <code>+100000 аванс</code>.\nПод каждой записью есть кнопки, чтобы поменять категорию или отменить.\n\n/today — лимит на сегодня\n/week — траты за 7 дней\n/limits — лимиты по категориям\n/advice — разбор финансов от советника\n\n💬 Вопрос советнику — просто напишите с «?»: <i>успею накопить на цель?</i>\n\n📄 Пришлите PDF-выписку Kaspi Gold, Банк ЦентрКредит, Freedom или Alatau City Bank — импортирую операции без дублей, а переводы между своими картами свяжу.\n\nУтренние и вечерние итоги включаются и выключаются в приложении: Настройки → Бюджет.\n\n🧪 /feedback — отзыв или идея: что неудобно, что сломалось, чего не хватает.",
    { parse_mode: "HTML" }
  ));

  // 📖 Инструкция: меню тем → тема (что это, зачем, как работает)
  bot.command(["guide", "instruction"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.reply(GUIDE_INTRO_HTML, { parse_mode: "HTML", reply_markup: guideMenuKeyboard() });
  });

  bot.callbackQuery(/^g:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === "menu") {
      await ctx.editMessageText(GUIDE_INTRO_HTML, { parse_mode: "HTML", reply_markup: guideMenuKeyboard() }).catch(() => undefined);
      return;
    }
    const topic = guideTopic(ctx.match[1]);
    if (!topic) return;
    const keyboard = new InlineKeyboard();
    const url = appUrl();
    if (url && topic.appPath) keyboard.webApp("Открыть в приложении", `${url}${topic.appPath}`).row();
    // «Дальше» — следующая тема, чтобы инструкцию можно было пройти подряд
    const index = GUIDE_TOPICS.indexOf(topic);
    const next = GUIDE_TOPICS[index + 1];
    if (next) keyboard.text(`Дальше: ${next.emoji} ${next.title}`, `g:${next.id}`).row();
    keyboard.text("← Все темы", "g:menu");
    await ctx.editMessageText(guideTopicHtml(topic), { parse_mode: "HTML", reply_markup: keyboard }).catch(() => undefined);
  });

  bot.command("feedback", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const text = ctx.match?.trim();
    if (text) {
      await acceptFeedback(ctx, user, text);
      return;
    }
    await ctx.reply(`${FEEDBACK_PROMPT} — текстом, голосом или скриншотом. Что неудобно, что сломалось, чего не хватает?`, {
      reply_markup: { force_reply: true, input_field_placeholder: "Ваш отзыв…" },
    });
  });

  // Ответ на приглашение написать отзыв — раньше остальных обработчиков
  bot.on("message", async (ctx, next) => {
    if (!isFeedbackReply(ctx)) return next();
    const user = await userFromContext(ctx);
    if (!user) return;
    const message = ctx.message;
    const text = message.text ?? message.caption ?? (message.voice ? "🎙 Голосовое сообщение" : message.photo ? "🖼 Скриншот" : "📎 Вложение");
    await acceptFeedback(ctx, user, text);
  });

  bot.command(["advice", "ask"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const question = ctx.match?.trim();
    await replyWithAdvice(ctx, user, question || ADVICE_REVIEW_PROMPT);
  });

  bot.on("message:text", async ctx => {
    if (ctx.message.text.startsWith("/")) return;
    const user = await userFromContext(ctx);
    if (!user) return;
    const text = ctx.message.text;
    if (looksLikeQuestion(text)) {
      await replyWithAdvice(ctx, user, text);
      return;
    }
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    const result = await captureText(user, text, "BOT_TEXT");
    // Не трата и без цифр, но похоже на фразу — отвечает советник
    if (!result.ok && result.reason === "not_understood" && !/\d/.test(text) && text.trim().split(/\s+/).length >= 3) {
      await replyWithAdvice(ctx, user, text);
      return;
    }
    await replyWithCapture(ctx, user, result);
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

  // 📄 Выписка банка в PDF
  bot.on("message:document", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const document = ctx.message.document;
    const isPdf = document.mime_type === "application/pdf" || document.file_name?.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      await ctx.reply("Пришлите выписку банка в PDF: например, Kaspi → Kaspi Gold → Выписка → Поделиться → этот бот.");
      return;
    }
    if ((document.file_size ?? 0) > MAX_DOCUMENT_BYTES) {
      await ctx.reply("Файл больше 20 МБ — выберите период покороче.");
      return;
    }

    const progress = await ctx.reply("📄 Разбираю выписку…");
    const edit = (text: string, reply_markup?: InlineKeyboard) =>
      ctx.api.editMessageText(progress.chat.id, progress.message_id, text, { parse_mode: "HTML", reply_markup });

    try {
      const file = await ctx.getFile();
      const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
      if (!response.ok) throw new Error(`download failed: ${response.status}`);
      const result = await createStatementDraft(user, new Uint8Array(await response.arrayBuffer()));

      if (!result.ok) {
        await edit(result.reason === "not_supported"
          ? "Не узнал выписку 🤔 Сейчас понимаю PDF-выписки Kaspi Gold, Банк ЦентрКредит, Freedom и Alatau City Bank."
          : "В выписке не нашлось операций за выбранный период.");
        return;
      }
      const count = result.summary.toImport + (result.summary.ownTransfers ?? 0);
      const keyboard = hasSomethingToImport(result.summary)
        ? new InlineKeyboard().text(`✅ Импортировать ${count}`, `ia:${result.batchId}`).text("Отмена", `ix:${result.batchId}`)
        : undefined;
      await edit(formatImportDraft(result.summary), keyboard);
    } catch (error) {
      console.error("Statement import failed:", errorMessage(error));
      await edit("Не получилось разобрать файл 😕 Попробуйте выгрузить выписку ещё раз.").catch(() => undefined);
    }
  });

  bot.callbackQuery(/^ia:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery("Импортирую…");
    await ctx.editMessageText("⏳ Импортирую и подбираю категории… Это займёт до минуты.").catch(() => undefined);
    try {
      const result = await applyImport(user, ctx.match[1]);
      if (!result.ok) {
        await ctx.editMessageText(result.reason === "cancelled" ? "Импорт был отменён." : "Этот импорт уже выполнен.");
        return;
      }
      await ctx.editMessageText(formatImportApplied(result.summary), {
        parse_mode: "HTML",
        reply_markup: appUrl()
          ? new InlineKeyboard().text("↩️ Отменить импорт", `iu:${ctx.match[1]}`).row().webApp("Открыть историю", `${appUrl()}/history`)
          : new InlineKeyboard().text("↩️ Отменить импорт", `iu:${ctx.match[1]}`),
      });
    } catch (error) {
      console.error("Apply import failed:", errorMessage(error));
      await ctx.editMessageText("Не получилось импортировать 😕 Черновик сохранён — пришлите выписку ещё раз.").catch(() => undefined);
    }
  });

  bot.callbackQuery(/^i[xu]:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const result = await cancelImport(user, ctx.match[1]);
    await ctx.answerCallbackQuery(result ? "Отменено" : "Уже отменено");
    if (result) {
      await ctx.editMessageText(result.wasApplied ? `↩️ Импорт отменён: удалено операций — ${result.removed}, баланс карты возвращён.` : "Импорт отменён.");
    }
  });

  // ── Список из нескольких операций в одном сообщении ──

  /** Пересобирает сообщение со списком после правки или отмены строки */
  async function refreshMultiReceipt(ctx: Context, user: ReceiptUser, ids: string[]) {
    if (ids.length === 0) {
      await ctx.editMessageText("↩️ Все записи из этого сообщения отменены").catch(() => undefined);
      return;
    }
    const view = await multiReceiptView(user, ids);
    await ctx.editMessageText(view.html, { parse_mode: "HTML", reply_markup: view.keyboard }).catch(() => undefined);
  }

  // 🏷 Выбор категории для строки списка
  bot.callbackQuery(/^mk:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const tx = await prisma.transaction.findFirst({ where: { id: ctx.match[1], userId: user.id } });
    if (!tx) return ctx.answerCallbackQuery("Запись не найдена");
    const categories = await prisma.category.findMany({ where: { userId: user.id, kind: tx.kind, archivedAt: null }, orderBy: { sortOrder: "asc" } });
    const keyboard = new InlineKeyboard();
    categories.forEach((category, index) => {
      keyboard.text(`${category.emoji} ${category.name}`, `mc:${tx.id}:${category.id}`);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text("← Назад к списку", `mb:${tx.id}`);
    await ctx.answerCallbackQuery(shortLabel(tx.note ?? "Выберите категорию", 60));
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  bot.callbackQuery(/^mc:(\w+):(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const [, transactionId, categoryId] = ctx.match;
    const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId: user.id } });
    const category = tx && await prisma.category.findFirst({ where: { id: categoryId, userId: user.id, kind: tx.kind } });
    if (!tx || !category) return ctx.answerCallbackQuery("Не получилось");
    await prisma.transaction.update({ where: { id: tx.id }, data: { categoryId: category.id } });
    await rememberMerchantCategory(user.id, tx.id, category.id);
    await ctx.answerCallbackQuery(`${category.emoji} ${category.name}`);
    await refreshMultiReceipt(ctx, user, await siblingTransactionIds(user.id, tx));
  });

  bot.callbackQuery(/^mb:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const tx = await prisma.transaction.findFirst({ where: { id: ctx.match[1], userId: user.id } });
    await ctx.answerCallbackQuery();
    if (tx) await refreshMultiReceipt(ctx, user, await siblingTransactionIds(user.id, tx));
  });

  // ↩️ Отмена одной строки списка
  bot.callbackQuery(/^mu:(\w+)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const tx = await prisma.transaction.findFirst({ where: { id: ctx.match[1], userId: user.id } });
    if (!tx) return ctx.answerCallbackQuery("Уже удалено");
    await deleteTransaction(user.id, tx.id);
    await ctx.answerCallbackQuery(`Отменено: ${formatMoney(fromDb(tx.amount))}${tx.note ? ` · ${shortLabel(tx.note, 40)}` : ""}`);
    await refreshMultiReceipt(ctx, user, await siblingTransactionIds(user.id, tx));
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
    await rememberMerchantCategory(user.id, tx.id, category.id);
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
    // Итоги получают только те, у кого сейчас есть доступ
    if (!hasAccess(user)) continue;
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
