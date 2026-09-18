import "server-only";
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { cardsEnabled, renderCard, warmCards } from "./cards/render";
import { fitCaption, goalCard, setupCard } from "@/lib/domain/cards";
import { checkGoalsReached } from "./goal-events";
import type { EffectName } from "@/lib/domain/botui";
import { prisma } from "./prisma";
import { upsertTelegramUser } from "./auth";
import { hasAccess, isOwner, ownerTelegramIds, redeemInvite } from "./access";
import { canImport, getPlan, grantPro, grantProForever, revokePro } from "./plan";
import { rotateApiKey } from "./api-key";
import { ACTION_BUTTON_PATH, BACK_TAP_PATH, pathText, shortcutLinks } from "@/lib/domain/shortcut";
import { FREE_LIMITS, PRICE, planLabel, planState, priceText } from "@/lib/domain/plan";
import { FEEDBACK_PROMPT, authorLine, feedbackRecipients, saveFeedback } from "./feedback";
import { captureAudio, captureText, type CaptureResult, type CapturedItem } from "./capture";
import { deleteTransaction } from "./ledger";
import { markPaymentPaid } from "./payments";
import { budgetLine, buildMultiReceipt, buildReceipt, escapeHtml, siblingTransactionIds } from "./receipt";
import { formatMoney, fromDb } from "@/lib/domain/money";
import { addDays, dayKeyOf, formatDayKeyShort, plural, relativeDays, daysBetween } from "@/lib/domain/dates";
import { formatLimitAlert, isMonday } from "@/lib/domain/digest";
import { buildEvening, buildLimitsMessage, buildMorning, buildWeekly, type BotMessage } from "./digests";
import { evaluateCategoryLimit } from "./limits";
import {
  applyImport, cancelImport, createStatementDraft, dismissTransferSuggestions, listTransferSuggestions,
  linkTransferSuggestions, rememberMerchantCategory,
} from "./imports";
import { formatImportApplied, formatImportDraft, hasSomethingToImport } from "@/lib/domain/importText";
import { ADVISOR_ERRORS, askAdvisor, streamAdvisor } from "./advisor";
import { ADVICE_REVIEW_PROMPT, ADVISOR_SUGGESTIONS, adviceToTelegramHtml, looksLikeQuestion } from "@/lib/domain/advisor";
import {
  ASK_HINT_HTML, KB, RECORD_HINT_HTML, STRANGER_HTML, expandable, h, isKeyboardText, lines, mainKeyboard, muted, quote, react, withEffect,
} from "./botui";
import { GUIDE_INTRO_HTML, GUIDE_TOPICS, guideTopic, guideTopicHtml } from "@/lib/domain/guide";
import { runWithCurrency } from "./currency-context";
import { getBudgetSnapshot } from "./overview";
import { registerOnboarding, startOnboarding, type OnboardingHelpers } from "./bot-onboarding";
import { getNbkRates } from "./rates";
import { extractPdfItems } from "./pdf";
import { isAiConfigured, parseLoansScreenshot, transcribeAudio } from "./ai";
import { KASPI_LOANS_TITLE, upsertKaspiLoans } from "./loans";
import { isKaspiLoanStatement, parseKaspiLoanStatement } from "@/lib/domain/kaspiLoans";
import { CURRENCIES, POPULAR_RATES, isCurrencyCode } from "@/lib/domain/currency";

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

type Markup = NonNullable<Parameters<Bot["api"]["sendMessage"]>[2]>["reply_markup"];

/**
 * Итоги картинкой-карточкой с текстом в подписи. Если картинка не получилась —
 * тот же текст обычным сообщением: итоги должны дойти в любом случае.
 */
async function sendBotMessage(
  api: Bot["api"],
  chatId: string | number,
  message: BotMessage,
  options: { cards: boolean; markup?: Markup; effect?: EffectName },
) {
  let image: Buffer | null = null;
  if (options.cards && message.card && cardsEnabled()) {
    image = await renderCard(message.card).catch(error => {
      console.error("Card render failed:", errorMessage(error));
      return null;
    });
  }

  const send = (extra: { message_effect_id?: string }): Promise<unknown> => {
    if (!image) return api.sendMessage(chatId, message.text, { parse_mode: "HTML", reply_markup: options.markup, ...extra });
    const { caption, rest } = fitCaption(message.text);
    return api.sendPhoto(chatId, new InputFile(image, "fincopilot.png"), {
      caption: caption ?? undefined,
      parse_mode: "HTML",
      reply_markup: rest ? undefined : options.markup,
      ...extra,
    }).then(async sent => {
      if (rest) await api.sendMessage(chatId, rest, { parse_mode: "HTML", reply_markup: options.markup });
      return sent;
    });
  };
  return options.effect ? withEffect(options.effect, send) : send({});
}

const onboardingHelpers: OnboardingHelpers = {
  userFromContext: ctx => userFromContext(ctx),
  sendBotMessage: (api, chatId, message, options) => sendBotMessage(api, chatId, message, options),
  appUrl: () => appUrl(),
};

function appUrl() {
  const url = process.env.APP_URL;
  return url?.startsWith("https://") ? url : null;
}

function openAppKeyboard(label = "Открыть FinCopilot") {
  const url = appUrl();
  return url ? new InlineKeyboard().webApp(label, url) : undefined;
}

function receiptKeyboard(transactionId: string) {
  return new InlineKeyboard().text("🏷 Категория", `k:${transactionId}`).text("↩️ Отменить", `u:${transactionId}`).style("danger");
}

/** Готовые вопросы советнику под кнопкой «💬 Спросить» */
function suggestionsKeyboard() {
  const keyboard = new InlineKeyboard();
  ADVISOR_SUGGESTIONS.slice(0, 4).forEach((question, index) => keyboard.text(question, `as:${index}`).row());
  return keyboard;
}

async function userFromContext(ctx: Context) {
  if (!ctx.from) return null;
  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (existing && hasAccess(existing)) return existing;
  if (isOwner(ctx.from.id)) return existing ?? upsertTelegramUser(ctx.from);
  // Посторонних не заводим в базе — только ответ
  await ctx.reply(STRANGER_HTML, { parse_mode: "HTML" });
  return null;
}

/** Куда платить: задаётся переменной PAY_KASPI, иначе — связаться с владельцем */
async function payInstructions() {
  const kaspi = process.env.PAY_KASPI;
  if (kaspi) return `Оплата: переведите на Kaspi <b>${escapeHtml(kaspi)}</b> и пришлите чек сюда — включу Pro в тот же день.`;
  const owners = ownerTelegramIds().map(id => BigInt(id));
  const owner = owners.length > 0
    ? await prisma.user.findFirst({ where: { telegramId: { in: owners }, username: { not: null } }, select: { username: true } })
    : null;
  return owner?.username
    ? `Оплата: напишите @${escapeHtml(owner.username)} — подскажет, куда перевести, и включит Pro.`
    : "Оплата: напишите владельцу бота — он включит Pro.";
}

/** Владелец включает Pro: /pro @ник 12 · /pro @ник навсегда · /pro @ник стоп */
async function handleGrant(ctx: Context, args: string) {
  const [target, term = "1"] = args.split(/\s+/);
  const handle = target.replace(/^@/, "");
  const user = await prisma.user.findFirst({
    where: /^\d+$/.test(handle) ? { telegramId: BigInt(handle) } : { username: { equals: handle, mode: "insensitive" } },
  });
  if (!user) {
    await ctx.reply(`Не нашёл пользователя ${target}. Нужен ник в Telegram или числовой id.`);
    return;
  }

  if (/^(стоп|off)$/i.test(term)) {
    await revokePro(user.id);
    await ctx.reply(`${authorLine(user)} — тариф снова бесплатный.`, { parse_mode: "HTML" });
    return;
  }

  if (/^(навсегда|forever)$/i.test(term)) {
    await grantProForever(user.id, "выдано владельцем");
    await ctx.reply(`${authorLine(user)} — Pro без ограничения по сроку 🎉`, { parse_mode: "HTML" });
    await notifyPro(ctx, user.telegramId, "Pro подключён без ограничения по сроку 🎉");
    return;
  }

  const months = Math.min(36, Math.max(1, Math.round(Number(term)) || 1));
  const amount = months % 12 === 0 ? PRICE.yearly * (months / 12) : PRICE.monthly * months;
  const until = await grantPro(user.id, months, { amount, method: "KASPI" });
  const untilText = until?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) ?? "";
  await ctx.reply(`${authorLine(user)} — Pro на ${months} мес., до ${untilText}. Учтено ${formatMoney(amount * 100)}.`, { parse_mode: "HTML" });
  await notifyPro(ctx, user.telegramId, `Pro подключён 🎉 Действует до ${untilText}. Спасибо, что поддерживаете FinCopilot!`);
}

/**
 * После импорта: пары «ушло с одной карты — пришло на другую», где банк не указал получателя.
 * Сами их не связываем — сначала спрашиваем, иначе можно склеить перевод другу с чужим поступлением.
 */
async function offerTransferSuggestions(ctx: Context, user: { id: string; timezone: string }) {
  const suggestions = await listTransferSuggestions(user).catch(() => []);
  if (suggestions.length === 0) return;

  const total = suggestions.reduce((sum, s) => sum + s.amount, 0);
  const lines = [
    `🔁 Похоже, это переводы между вашими картами — банк не указал получателя:`,
    "",
    ...suggestions.slice(0, 8).map(s => `• ${formatDayKeyShort(s.day)} · ${escapeHtml(s.fromAccount)} → ${escapeHtml(s.toAccount)} · <b>${formatMoney(s.amount)}</b>`),
    ...(suggestions.length > 8 ? [`…и ещё ${suggestions.length - 8}`] : []),
    "",
    `Сейчас они считаются и расходом, и доходом — это завышает статистику на <b>${formatMoney(total)}</b>.`,
    "Связать их в переводы?",
  ];
  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text(`✅ Связать ${suggestions.length}`, "tl").style("success").text("Это не мои", "td"),
  });
}

function notifyPro(ctx: Context, telegramId: bigint, text: string) {
  return ctx.api.sendMessage(String(telegramId), text).catch(() => undefined);
}

function guideMenuKeyboard() {
  const keyboard = new InlineKeyboard();
  GUIDE_TOPICS.forEach((topic, index) => {
    keyboard.text(`${topic.emoji} ${topic.title}`, `g:${topic.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

/** Скачивает голосовое сообщение и превращает его в текст */
async function transcribeVoice(ctx: Context) {
  const voice = ctx.message?.voice;
  if (!voice || !isAiConfigured()) return null;
  const file = await ctx.api.getFile(voice.file_id);
  const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) return null;
  return transcribeAudio(Buffer.from(await response.arrayBuffer()), voice.mime_type || "audio/ogg");
}

/** Отзыв: ответ на сообщение бота с приглашением написать отзыв */
function isFeedbackReply(ctx: Context) {
  const reply = ctx.message?.reply_to_message;
  return Boolean(reply?.from?.is_bot && reply.text?.startsWith(FEEDBACK_PROMPT));
}

async function acceptFeedback(ctx: Context, user: NonNullable<Awaited<ReturnType<typeof userFromContext>>>, text: string) {
  const message = ctx.message;
  // Голосовой отзыв расшифровываем — иначе в базе останется только «🎙 Голосовое сообщение»
  const transcript = message?.voice ? await transcribeVoice(ctx).catch(() => null) : null;
  await saveFeedback(user, transcript ? `🎙 ${transcript}` : text, "BOT");
  // Голос и скриншоты пересылаем владельцам как есть
  if (message && (message.voice || message.photo || message.document || message.video)) {
    for (const chatId of feedbackRecipients(user)) {
      await ctx.api.sendMessage(chatId, `📎 Вложение к отзыву от ${authorLine(user)}:`, { parse_mode: "HTML" }).catch(() => undefined);
      await ctx.api.copyMessage(chatId, message.chat.id, message.message_id).catch(() => undefined);
    }
  }
  await ctx.reply("Спасибо! 🙏 Отзыв получен — это правда помогает сделать FinCopilot лучше.");
}

const CAPTURE_ERRORS: Record<Extract<CaptureResult, { ok: false }>["reason"], string> = {
  ai_unavailable: lines("Не разобрал сумму.", "Напишите так: <code>кофе 1200</code>"),
  rate_limited: "Слишком много сообщений подряд — подождите минуту.",
  not_understood: lines("Не разобрал, что записать.", "Попробуйте так: <code>такси 1500</code> или <code>+250000 зарплата</code>"),
  plan_limit: lines(
    `На бесплатном тарифе — ${FREE_LIMITS.aiPerMonth} записей голосом и текстом в месяц, они закончились.`,
    muted("В приложении записывать можно без ограничений, а Pro снимает лимит: /subscribe"),
  ),
};

async function replyWithCapture(ctx: Context, user: ReceiptUser, result: CaptureResult) {
  if (!result.ok) {
    if (result.reason === "not_understood" || result.reason === "ai_unavailable") await react(ctx, "🤔");
    await ctx.reply(CAPTURE_ERRORS[result.reason], { parse_mode: "HTML" });
    return;
  }
  const sent = await sendReceipts(ctx.api, String(ctx.chat!.id), user, result.items);
  // Реакция на сообщение человека: «записал» — и сразу видно, что это было
  await react(ctx, sent.limitHit ? "🙈" : result.items.length > 1 ? "👌" : sent.kind === "INCOME" ? "🔥" : "✍");
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
/** Самая первая запись человека — празднуем один раз за всё время */
async function claimFirstCapture(userId: string) {
  const { count } = await prisma.user.updateMany({ where: { id: userId, firstCaptureCelebratedAt: null }, data: { firstCaptureCelebratedAt: new Date() } });
  return count > 0;
}

const FIRST_CAPTURE_LINE = "\n\n🎉 Первая запись — отличное начало!";

export async function sendReceipts(api: Bot["api"], chatId: string, user: ReceiptUser, items: CapturedItem[]) {
  const first = await claimFirstCapture(user.id);
  const send = (html: string, reply_markup: InlineKeyboard) => first
    ? withEffect("confetti", extra => api.sendMessage(chatId, html + FIRST_CAPTURE_LINE, { parse_mode: "HTML", reply_markup, ...extra }))
    : api.sendMessage(chatId, html, { parse_mode: "HTML", reply_markup });

  if (items.length === 1) {
    const receipt = await buildReceipt(user, items[0].transactionId, items[0].linkedPaymentTitle);
    if (receipt) await send(receipt.html, receiptKeyboard(items[0].transactionId));
    await notifyGoalsReached(user.id);
    return { limitHit: receipt?.limitLevel === 100, kind: receipt?.transaction.kind ?? null };
  }
  const view = await multiReceiptView(user, items.map(i => i.transactionId));
  await send(view.html, view.keyboard);
  await notifyGoalsReached(user.id);
  return { limitHit: false, kind: null };
}

const DRAFT_MIN_INTERVAL_MS = 700;
// Черновик живёт 30 с — если размышления идут дольше, обновляем его же текстом, чтобы не истёк
const DRAFT_KEEP_ALIVE_MS = 8000;

async function replyWithAdvice(ctx: Context, user: Parameters<typeof askAdvisor>[0], question: string) {
  const chatId = ctx.chat!.id;
  const url = appUrl();
  const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);

  // «Печатает на глазах»: обновляем один и тот же черновик, пока не пришлём настоящее сообщение
  let draftsOk = true;
  let lastText = "";
  let lastSentAt = 0;
  async function sendDraft(text: string) {
    if (!draftsOk) return;
    try {
      await ctx.api.sendMessageDraft(chatId, draftId, text ? `💬 ${adviceToTelegramHtml(text)}` : "", { parse_mode: "HTML", can_stop: true });
      lastSentAt = Date.now();
    } catch {
      // Черновики недоступны в этой версии клиента — тихо переходим на обычное «печатает…»
      draftsOk = false;
    }
  }

  await sendDraft("");
  await ctx.replyWithChatAction("typing").catch(() => undefined);
  const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => undefined), 4500);
  const keepAlive = setInterval(() => {
    if (draftsOk && Date.now() - lastSentAt > DRAFT_KEEP_ALIVE_MS) sendDraft(lastText);
  }, 4000);

  try {
    const result = await streamAdvisor(user, question, "BOT", {
      onText: async full => {
        lastText = full;
        if (draftsOk && Date.now() - lastSentAt >= DRAFT_MIN_INTERVAL_MS) await sendDraft(full);
      },
      shouldStop: async () => {
        // Кнопка «Стоп» приходит отдельным апдейтом — возможно, на другой инстанс, поэтому через базу
        const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { advisorStoppedDraftId: true } });
        return fresh?.advisorStoppedDraftId === draftId;
      },
    });

    const keyboard = new InlineKeyboard();
    if (result.ok && url) keyboard.webApp("Продолжить в приложении", `${url}/advisor`).row();
    if (result.ok) {
      const suggestionIndex = ADVISOR_SUGGESTIONS.findIndex(q => q !== question);
      if (suggestionIndex >= 0) keyboard.text(`💡 ${shortLabel(ADVISOR_SUGGESTIONS[suggestionIndex], 40)}`, `as:${suggestionIndex}`);
    }
    const text = result.ok
      ? `💬 ${adviceToTelegramHtml(result.answer)}${result.stopped ? muted("\n\n⏹ Остановлено") : ""}`
      : ADVISOR_ERRORS[result.reason];
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined });
  } finally {
    clearInterval(typing);
    clearInterval(keepAlive);
  }
}

function registerHandlers(bot: Bot) {
  // Все суммы в ответах бота — в валюте пользователя
  bot.use(async (ctx, next) => {
    const currency = ctx.from
      ? (await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { currency: true } }))?.currency
      : null;
    await runWithCurrency(currency, next);
  });

  // Настройка в чате: её ответы перехватываются раньше записи трат
  registerOnboarding(bot, onboardingHelpers);

  // Кнопка «Стоп» у черновика ответа советника — отдельный тип апдейта, может прийти на другой инстанс
  bot.on("stopped_message_generation", async ctx => {
    const update = ctx.update.stopped_message_generation;
    if (!update) return;
    await prisma.user.updateMany({
      where: { telegramId: BigInt(update.chat.id) },
      data: { advisorStoppedDraftId: update.draft_id },
    }).catch(() => undefined);
  });

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
        const inviterChat = String(result.inviterTelegramId);
        await withEffect("confetti", extra => ctx.api.sendMessage(inviterChat, `🎉 ${authorLine(result.user)} принял(а) ваше приглашение в FinCopilot`, { parse_mode: "HTML", ...extra }))
          .catch(() => undefined);
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

    // Уже настроен — короткое «с возвращением» и нижняя клавиатура
    if (user.onboardedAt) {
      const snapshot = await getBudgetSnapshot(user);
      await sendBotMessage(ctx.api, ctx.chat.id, {
        text: lines(
          `С возвращением${user.firstName ? `, ${escapeHtml(user.firstName)}` : ""} 👋`,
          "",
          await budgetLine(user),
          "",
          muted("Пишите траты сюда или голосом. Приложение — кнопка «Финансы» слева от поля ввода."),
        ),
        card: setupCard({
          firstName: user.firstName,
          today: snapshot.today,
          horizon: snapshot.horizon,
          hasIncomeSchedule: snapshot.hasIncomeSchedule,
          leftToday: snapshot.budget.leftToday,
          daysLeft: snapshot.budget.daysLeft,
          trial: false,
          welcomeBack: true,
        }),
      }, { cards: user.digestCards, markup: mainKeyboard() });
      return;
    }

    // Новичок настраивается прямо в чате
    await startOnboarding(ctx, user, onboardingHelpers);
  });

  // Инструкция отдельным сообщением — приветствие остаётся в чате
  bot.callbackQuery("g:new", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(GUIDE_INTRO_HTML, { parse_mode: "HTML", reply_markup: guideMenuKeyboard() });
  });

  async function runToday(ctx: Context) {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.replyWithChatAction(user.digestCards ? "upload_photo" : "typing").catch(() => undefined);
    const morning = await buildMorning(user);
    await sendBotMessage(ctx.api, ctx.chat!.id, morning, { cards: user.digestCards, markup: morning.keyboard ?? openAppKeyboard("Подробнее") });
  }

  async function runWeek(ctx: Context) {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.replyWithChatAction(user.digestCards ? "upload_photo" : "typing").catch(() => undefined);
    const today = dayKeyOf(new Date(), user.timezone);
    const weekly = await buildWeekly(user, { from: addDays(today, -6), to: today });
    await sendBotMessage(ctx.api, ctx.chat!.id, weekly, { cards: user.digestCards, markup: openAppKeyboard("Аналитика") });
  }

  bot.command(["today", "budget"], runToday);
  bot.command("week", runWeek);

  // Нижняя клавиатура — раньше разбора текста, иначе «💸 Сегодня» стало бы тратой
  bot.hears(KB.today, runToday);
  bot.hears(KB.week, runWeek);
  bot.hears(KB.record, async ctx => {
    if (!(await userFromContext(ctx))) return;
    await ctx.reply(RECORD_HINT_HTML, { parse_mode: "HTML" });
  });
  bot.hears(KB.ask, async ctx => {
    if (!(await userFromContext(ctx))) return;
    await ctx.reply(ASK_HINT_HTML, { parse_mode: "HTML", reply_markup: suggestionsKeyboard() });
  });

  bot.callbackQuery(/^as:(\d)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const question = ADVISOR_SUGGESTIONS[Number(ctx.match[1])];
    await ctx.answerCallbackQuery();
    if (question) await replyWithAdvice(ctx, user, question);
  });

  bot.command("limits", async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    await ctx.reply((await buildLimitsMessage(user)).text, { parse_mode: "HTML", reply_markup: openAppKeyboard("Настроить лимиты") });
  });

  bot.command("help", ctx => ctx.reply(
    lines(
      "✍️ " + h("Записывайте как удобно"),
      "<code>обед 2500</code> · <code>1 500 такси</code> · доход с плюсом: <code>+100000 аванс</code>",
      "Голосом — можно сразу несколько трат. Под записью — кнопки категории и отмены.",
      "",
      "💬 Вопрос советнику — просто напишите с «?»: " + muted("успею накопить на цель?"),
      "📄 PDF-выписка Kaspi Gold, БЦК, Freedom или Alatau — импортирую без дублей.",
      "",
      h("Команды"),
      expandable(lines(
        "/today — сколько можно потратить сегодня",
        "/week — траты за 7 дней",
        "/limits — лимиты по категориям",
        "/advice — разбор месяца от советника",
        "/rates — курс Нацбанка",
        "/iphone — запись касанием по iPhone",
        "/subscribe — тариф и Pro",
        "/guide — подробная инструкция",
        "/feedback — отзыв или идея",
      )),
      muted("Утренние и вечерние итоги включаются в приложении: Настройки → Бюджет."),
    ),
    { parse_mode: "HTML", reply_markup: mainKeyboard() },
  ));

  // 🏦 Кредиты Kaspi из выписки: общий платёж и день
  bot.callbackQuery(/^lo:(\d+):(\d{1,2})$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const monthly = Number(ctx.match[1]);
    const dueDay = Number(ctx.match[2]);
    const result = await upsertKaspiLoans(user, { monthly, dueDay });
    await ctx.answerCallbackQuery(result ? "Добавлено" : "Не получилось");
    if (!result) return;
    const url = appUrl();
    await ctx.editMessageText(
      `✅ <b>${KASPI_LOANS_TITLE}</b> — ${formatMoney(monthly)} каждое ${dueDay}-е ${result.created ? "добавлены" : "обновлены"} в платежах.\n\n📸 Пришлите скриншот «Мои кредиты» из Kaspi — подставлю остаток долга.`,
      { parse_mode: "HTML", reply_markup: url ? new InlineKeyboard().webApp("Открыть платежи", `${url}/payments`) : undefined }
    ).catch(() => undefined);
  });

  // 📸 Остаток долга со скриншота
  bot.callbackQuery(/^lr:(\d+):(\d*):(\d*)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const remaining = Number(ctx.match[1]);
    const monthly = ctx.match[2] ? Number(ctx.match[2]) : undefined;
    const dueDay = ctx.match[3] ? Number(ctx.match[3]) : undefined;
    const result = await upsertKaspiLoans(user, { remaining, monthly, dueDay });
    await ctx.answerCallbackQuery(result ? "Сохранено" : "Не получилось");
    if (!result) {
      await ctx.editMessageText("Не хватает ежемесячного платежа и дня списания. Сначала пришлите PDF «Выписка по кредитам» из Kaspi.").catch(() => undefined);
      return;
    }
    const url = appUrl();
    await ctx.editMessageText(
      `✅ Остаток долга <b>${formatMoney(remaining)}</b> сохранён в «${KASPI_LOANS_TITLE}».\nВ «Платежах» появились общий долг и калькулятор досрочного погашения.`,
      { parse_mode: "HTML", reply_markup: url ? new InlineKeyboard().webApp("Открыть платежи", `${url}/payments`) : undefined }
    ).catch(() => undefined);
  });

  bot.on("message:photo", async (ctx, next) => {
    // Скриншот в ответ на просьбу об отзыве — это отзыв, его обработает обработчик ниже
    if (isFeedbackReply(ctx)) return next();
    const user = await userFromContext(ctx);
    if (!user) return;
    if (!isAiConfigured()) return;
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    const photo = ctx.message.photo.at(-1)!;
    const file = await ctx.api.getFile(photo.file_id);
    const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) {
      await ctx.reply("Не удалось скачать фото, попробуйте ещё раз.");
      return;
    }
    const parsed = await parseLoansScreenshot(Buffer.from(await response.arrayBuffer()), "image/jpeg").catch(() => null);
    if (!parsed?.isLoanScreen || parsed.loans.length === 0) {
      await ctx.reply("На фото не вижу кредитов 🤔 Чтобы подставить остаток долга, пришлите скриншот списка кредитов из приложения банка. Для отзыва со скриншотом — /feedback.");
      return;
    }
    const remaining = parsed.loans.reduce((sum, l) => sum + l.remaining, 0);
    const monthlyKnown = parsed.loans.every(l => l.monthlyPayment !== null);
    const monthly = monthlyKnown ? parsed.loans.reduce((sum, l) => sum + (l.monthlyPayment ?? 0), 0) : null;
    const dueDay = parsed.loans.find(l => l.nextPaymentDay)?.nextPaymentDay ?? null;
    const lines = [
      "📸 <b>Кредиты на скриншоте</b>",
      "",
      ...parsed.loans.map(l => `• ${escapeHtml(l.title)} — осталось ${formatMoney(l.remaining)}${l.monthlyPayment ? `, платёж ${formatMoney(l.monthlyPayment)}` : ""}`),
      "",
      `Остаток долга: <b>${formatMoney(remaining)}</b>`,
      "",
      "Проверьте суммы — ИИ мог ошибиться. Если на экране не все кредиты, пришлите ещё скриншот, а потом сохраните общий остаток.",
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(`✅ Сохранить остаток ${formatMoney(remaining)}`, `lr:${remaining}:${monthly ?? ""}:${dueDay ?? ""}`).style("success"),
    });
  });

  // 💱 Курсы Нацбанка РК
  // 📱 Запись трат касанием по задней панели iPhone или кнопкой действия
  function shortcutIntro() {
    const links = shortcutLinks(process.env);
    const url = appUrl();
    const keyboard = new InlineKeyboard().text("🔑 Создать ключ", "sh:k").style("primary");
    if (links.install) keyboard.row().url("Установить команду", links.install);
    if (url) keyboard.row().webApp("Подробнее в приложении", `${url}/settings#shortcut`);
    return {
      text: lines(
        "📱 " + h("Трата одним касанием"),
        "Двойное касание по задней панели iPhone (или кнопка действия) — говорите «кофе 1200», и трата записана.",
        "",
        "1. Создайте ключ",
        links.install ? "2. Установите команду и вставьте ключ" : "2. Соберите команду по инструкции в приложении",
        `3. Назначьте её: ${pathText(BACK_TAP_PATH)}`,
        "",
        muted(`Кнопка действия (iPhone 15 Pro и новее): ${pathText(ACTION_BUTTON_PATH)}`),
      ),
      keyboard,
    };
  }

  bot.command("iphone", async ctx => {
    if (!(await userFromContext(ctx))) return;
    const view = shortcutIntro();
    await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  });

  bot.callbackQuery(/^sh:(i|k|ky|x|d)$/, async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const action = ctx.match[1];

    if (action === "i") {
      await ctx.answerCallbackQuery();
      const view = shortcutIntro();
      await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
      return;
    }
    if (action === "d") {
      await ctx.answerCallbackQuery("Удалено");
      await ctx.deleteMessage().catch(() => ctx.editMessageText("Сообщение с ключом скрыто."));
      return;
    }
    if (action === "x") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Ок, ключ оставляю прежним.").catch(() => undefined);
      return;
    }

    if (!getPlan(user).pro) {
      await ctx.answerCallbackQuery();
      await ctx.reply("✨ Запись с iPhone входит в Pro. Подробнее — /subscribe");
      return;
    }
    if (action === "k" && user.apiKeyHint) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        lines(`У вас уже есть ключ <code>fc_…${escapeHtml(user.apiKeyHint)}</code>.`, "Новый ключ отключит старую команду — её нужно будет установить заново."),
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Создать новый", "sh:ky").style("danger").text("Отмена", "sh:x") },
      ).catch(() => undefined);
      return;
    }

    const key = await rotateApiKey(user.id);
    await ctx.answerCallbackQuery("Ключ создан");
    const links = shortcutLinks(process.env);
    const keyboard = new InlineKeyboard().copyText("📋 Скопировать ключ", key).style("success");
    if (links.install) keyboard.row().url("Установить команду", links.install);
    keyboard.row().text("Удалить сообщение", "sh:d");
    await ctx.editMessageText(
      lines(
        "🔑 " + h("Ключ создан"),
        links.install ? "Нажмите «Скопировать ключ» и вставьте его при установке команды." : "Нажмите «Скопировать ключ» и вставьте его в заголовок Authorization команды.",
        "",
        muted("Ключ виден только здесь — не пересылайте это сообщение. После установки его можно удалить."),
      ),
      { parse_mode: "HTML", reply_markup: keyboard },
    ).catch(() => undefined);
  });

  bot.command(["rates", "kurs"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const { date, rates } = await getNbkRates();
    if (rates.length === 0) {
      await ctx.reply("Сайт Нацбанка сейчас не отвечает — попробуйте чуть позже.");
      return;
    }
    const number = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lines = POPULAR_RATES.map(code => rates.find(r => r.code === code)).filter(r => r !== undefined).map(rate => {
      const info = isCurrencyCode(rate.code) ? CURRENCIES[rate.code] : null;
      const arrow = rate.direction === "UP" ? "▲" : rate.direction === "DOWN" ? "▼" : "";
      return `${info?.flag ?? "💱"} <b>${rate.code}</b> — ${number.format(rate.rate)} ₸ ${arrow}`.trim();
    });
    const url = appUrl();
    await ctx.reply(
      [`💱 <b>Курс Нацбанка РК</b>${date ? ` на ${date.split("-").reverse().join(".")}` : ""}`, "", ...lines].join("\n"),
      { parse_mode: "HTML", reply_markup: url ? new InlineKeyboard().webApp("Все курсы и конвертер", `${url}/rates`) : undefined }
    );
  });

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

  bot.command(["subscribe", "pro", "plan"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;

    // Владелец выдаёт Pro: /pro @ник 12 | /pro @ник навсегда | /pro @ник стоп
    const args = ctx.match?.trim();
    if (args && isOwner(ctx.from!.id)) {
      await handleGrant(ctx, args);
      return;
    }

    const state = planState(user);
    const text = lines(
      "✨ " + h(`Ваш тариф: ${escapeHtml(planLabel(state))}`),
      "",
      h("Pro — всё без ограничений"),
      quote(lines(
        "голос и текст без лимита, несколько трат за раз",
        "выписки всех банков сколько угодно",
        "ИИ-советник по вашим деньгам",
        "кнопка на iPhone, Apple Pay и SMS банка",
        "прогноз остатка, цели, мультивалюта",
      )),
      `${h(`${PRICE.monthly.toLocaleString("ru-RU")} ${PRICE.currency}`)} в месяц · ${h(`${PRICE.yearly.toLocaleString("ru-RU")} ${PRICE.currency}`)} в год — выгоднее на 28%`,
      "",
      await payInstructions(),
      "",
      muted(`Бесплатно навсегда: ${FREE_LIMITS.aiPerMonth} записей ИИ в месяц, одна выписка и ручной ввод без ограничений.`),
    );
    const url = appUrl();
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: url ? new InlineKeyboard().webApp("Открыть FinCopilot", url).style("primary") : undefined,
    });
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
    if (ctx.message.text.startsWith("/") || isKeyboardText(ctx.message.text)) return;
    const user = await userFromContext(ctx);
    if (!user) return;
    const text = ctx.message.text;
    if (looksLikeQuestion(text)) {
      await replyWithAdvice(ctx, user, text);
      return;
    }
    // Мгновенный знак «вижу» — пока разбираем текст
    await react(ctx, "👀");
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
    await react(ctx, "👀");
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
      const bytes = new Uint8Array(await response.arrayBuffer());

      // Выписка по кредитам Kaspi — не операции по карте, а договоры и ежемесячные платежи
      const pages = await extractPdfItems(bytes);
      if (isKaspiLoanStatement(pages)) {
        const loans = parseKaspiLoanStatement(pages);
        if (loans.contracts.length === 0 || !loans.dueDay) {
          await edit("В выписке по кредитам не нашлось действующих кредитов 🎉");
          return;
        }
        const lines = [
          "🏦 <b>Выписка по кредитам Kaspi</b>",
          "",
          `Действующих кредитов: <b>${loans.contracts.length}</b>${loans.closedContracts ? ` (закрыто досрочно: ${loans.closedContracts})` : ""}`,
          ...loans.contracts.map(c => `• ${escapeHtml(c.title)} — ${formatMoney(c.monthlyPayment)}`),
          "",
          `Общий платёж: <b>${formatMoney(loans.totalMonthly)}</b> каждое <b>${loans.dueDay}-е</b>`,
          "",
          "Добавлю его в «Платежи» одним обязательством «Kaspi кредиты» — он будет заранее откладываться в лимите, а бот напомнит о списании.",
          "",
          "📸 Остатка долга в выписке нет. Пришлите скриншот списка кредитов из Kaspi (раздел «Мои кредиты») — я подставлю остаток сам.",
        ];
        await edit(lines.join("\n"), new InlineKeyboard().text(`✅ Добавить ${formatMoney(loans.totalMonthly)} · ${loans.dueDay}-е`, `lo:${loans.totalMonthly}:${loans.dueDay}`).style("success"));
        return;
      }

      if (!(await canImport(user))) {
        await edit([
          "На бесплатном тарифе можно загрузить одну выписку — она уже загружена.",
          "",
          "Pro снимает ограничение: все выписки всех банков, безлимитный голосовой ввод и ИИ-советник.",
          "Сколько стоит и как подключить — /subscribe",
        ].join("\n"));
        return;
      }

      const result = await createStatementDraft(user, bytes);

      if (!result.ok) {
        await edit(result.reason === "not_supported"
          ? "Не узнал выписку 🤔 Сейчас понимаю PDF-выписки Kaspi Gold, Банк ЦентрКредит, Freedom и Alatau City Bank."
          : "В выписке не нашлось операций за выбранный период.");
        return;
      }
      const count = result.summary.toImport + (result.summary.ownTransfers ?? 0);
      const keyboard = hasSomethingToImport(result.summary)
        ? new InlineKeyboard().text(`✅ Импортировать ${count}`, `ia:${result.batchId}`).style("success").text("Отмена", `ix:${result.batchId}`)
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
          ? new InlineKeyboard().text("↩️ Отменить импорт", `iu:${ctx.match[1]}`).style("danger").row().webApp("Открыть историю", `${appUrl()}/history`)
          : new InlineKeyboard().text("↩️ Отменить импорт", `iu:${ctx.match[1]}`).style("danger"),
      });
      await offerTransferSuggestions(ctx, user);
      await notifyGoalsReached(user.id);
    } catch (error) {
      console.error("Apply import failed:", errorMessage(error));
      await ctx.editMessageText("Не получилось импортировать 😕 Черновик сохранён — пришлите выписку ещё раз.").catch(() => undefined);
    }
  });

  // Подтверждение переводов между своими картами после импорта
  bot.callbackQuery(["tl", "td"], async ctx => {
    const user = await userFromContext(ctx);
    if (!user) return;
    const suggestions = await listTransferSuggestions(user);
    if (suggestions.length === 0) {
      await ctx.answerCallbackQuery("Уже нечего связывать");
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      return;
    }

    if (ctx.callbackQuery.data === "tl") {
      const linked = await linkTransferSuggestions(user, suggestions.map(s => s.outId));
      await ctx.answerCallbackQuery(`Связано: ${linked}`);
      await ctx.editMessageText(
        `✅ Связано переводов: <b>${linked}</b> — теперь они не считаются ни расходом, ни доходом.\nОтменить можно в «Настройках» → «Выписки банков».`,
        { parse_mode: "HTML" },
      ).catch(() => undefined);
      return;
    }

    await dismissTransferSuggestions(user, suggestions.flatMap(s => [s.outId, s.incomingId]));
    await ctx.answerCallbackQuery("Больше не предложу");
    await ctx.editMessageText("Понял, это не переводы между своими картами — оставляю как есть.").catch(() => undefined);
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
export async function notifyCategoryLimit(user: { id: string; timezone: string; telegramId: bigint; currency: string }, categoryId: string | null, at: Date) {
  // Вызывается после ответа (after) — вне контекста запроса, валюту задаём явно
  return runWithCurrency(user.currency, () => sendCategoryLimit(user, categoryId, at));
}

async function sendCategoryLimit(user: { id: string; timezone: string; telegramId: bigint }, categoryId: string | null, at: Date) {
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

/** Поздравление с достигнутой целью: карточка-трофей с конфетти. Ошибки не мешают основному действию */
export async function notifyGoalsReached(userId: string) {
  if (!isBotConfigured()) return;
  try {
    const reached = await checkGoalsReached(userId);
    if (reached.length === 0) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const bot = await getBot();
    const url = appUrl();
    await runWithCurrency(user.currency, async () => {
      for (const goal of reached) {
        await sendBotMessage(bot.api, String(user.telegramId), {
          text: lines(
            "🏆 " + h(`Цель «${escapeHtml(goal.title)}» достигнута`),
            `${formatMoney(goal.amount)} накоплено. Так держать!`,
          ),
          card: goalCard(goal),
        }, {
          cards: user.digestCards,
          markup: url ? new InlineKeyboard().webApp("Мои цели", `${url}/goals`) : undefined,
          effect: "confetti",
        });
      }
    });
  } catch (error) {
    console.error("Goal notify failed:", errorMessage(error));
  }
}

/** Уведомление пригласившему: друг настроил профиль — начислен бонус Pro */
export async function notifyReferralReward(referrerTelegramId: bigint, days: number) {
  if (!isBotConfigured()) return;
  try {
    const bot = await getBot();
    await withEffect("confetti", extra => bot.api.sendMessage(
      String(referrerTelegramId),
      lines(
        "🎉 " + h(`+${days} ${plural(days, "день", "дня", "дней")} Pro — в подарок`),
        "Друг настроил FinCopilot по вашей ссылке. Спасибо, что делитесь!",
      ),
      { parse_mode: "HTML", reply_markup: openAppKeyboard("Открыть FinCopilot"), ...extra },
    ));
  } catch (error) {
    console.error("Referral reward notify failed:", errorMessage(error));
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
      reply_markup: new InlineKeyboard().text("✅ Оплачено", `p:${payment.id}`).style("success"),
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
async function claim(userId: string, field: "lastMorningOn" | "lastEveningOn" | "lastWeeklyOn" | "lastTrialReminderOn" | "lastWinbackOn", today: string, previous: string | null) {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ [field]: null }, { [field]: { not: today } }] },
    data: { [field]: today },
  });
  return { claimed: count > 0, release: () => prisma.user.update({ where: { id: userId }, data: { [field]: previous } }) };
}

/** «Пробный период заканчивается» — за 3 дня и за 1 день до конца */
async function maybeSendTrialReminder(bot: Bot, user: ScheduledUser) {
  if (!user.remindersEnabled) return;
  const state = planState(user);
  if (state.kind !== "trial" || state.daysLeft === null) return;
  if (state.daysLeft !== 3 && state.daysLeft !== 1) return;

  const today = dayKeyOf(new Date(), user.timezone);
  const lock = await claim(user.id, "lastTrialReminderOn", today, user.lastTrialReminderOn);
  if (!lock.claimed) return;
  try {
    const text = state.daysLeft === 1
      ? `⏰ Завтра заканчивается пробный период Pro.\n\nБез Pro — ${FREE_LIMITS.aiPerMonth} записей ИИ в месяц и один импорт выписки. Чтобы сохранить голос без ограничений, советника и прогноз — ${priceText()}.`
      : `⏳ Пробный период Pro заканчивается через 3 дня.\n\nЧтобы сохранить все возможности — ${priceText()}.`;
    await bot.api.sendMessage(String(user.telegramId), text, { parse_mode: "HTML", reply_markup: openAppKeyboard("Продлить Pro") });
  } catch (error) {
    await lock.release();
    console.error("Trial reminder failed:", errorMessage(error));
  }
}

/** «Давно не было записей» — не чаще раза в 14 дней, максимум 3 раза за всё время */
async function maybeSendWinback(bot: Bot, user: ScheduledUser) {
  if (!user.remindersEnabled || user.winbackCount >= 3) return;
  // Первую неделю после онбординга ведёт чек-лист первых шагов — не дублируем напоминания
  if (!user.onboardedAt || Date.now() - user.onboardedAt.getTime() < 7 * 24 * 60 * 60 * 1000) return;

  const today = dayKeyOf(new Date(), user.timezone);
  if (user.lastWinbackOn && daysBetween(user.lastWinbackOn, today) < 14) return;

  const [lastTx, txCount] = await Promise.all([
    prisma.transaction.findFirst({ where: { userId: user.id }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.transaction.count({ where: { userId: user.id } }),
  ]);
  // Не было настоящей активности — это недоактивация, а не «ушёл», ей займётся чек-лист
  if (!lastTx || txCount < 3) return;
  const silence = daysBetween(dayKeyOf(lastTx.occurredAt, user.timezone), today);
  if (silence < 5) return;

  const lock = await claim(user.id, "lastWinbackOn", today, user.lastWinbackOn);
  if (!lock.claimed) return;
  try {
    const text = `👋 Не было записей уже ${silence} ${plural(silence, "день", "дня", "дней")}.\n\n${await budgetLine(user)}\n\nЗапишите трату сообщением или голосом — бот справится.`;
    await bot.api.sendMessage(String(user.telegramId), text, { parse_mode: "HTML", reply_markup: openAppKeyboard("Открыть FinCopilot") });
    await prisma.user.update({ where: { id: user.id }, data: { winbackCount: { increment: 1 } } });
  } catch (error) {
    await lock.release();
    console.error("Winback failed:", errorMessage(error));
  }
}

/** Утренние (+ недельные по понедельникам) и вечерние итоги. Вызывается кроном. */
export async function sendScheduledDigests(slot: "morning" | "evening") {
  const bot = await getBot();
  const users = await prisma.user.findMany({ where: { onboardedAt: { not: null } } });
  // Шрифты карточек читаются один раз на всю рассылку. Пользователи идут по очереди —
  // при сотнях получателей понадобится пул из нескольких параллельных отправок.
  await warmCards();
  const result = { sent: 0, failed: 0 };

  async function deliver(user: ScheduledUser, field: "lastMorningOn" | "lastEveningOn" | "lastWeeklyOn", build: () => Promise<BotMessage>, after?: () => Promise<unknown>) {
    const today = dayKeyOf(new Date(), user.timezone);
    const lock = await claim(user.id, field, today, user[field]);
    if (!lock.claimed) return;
    try {
      const message = await build();
      await sendBotMessage(bot.api, String(user.telegramId), message, {
        cards: user.digestCards,
        markup: message.keyboard ?? openAppKeyboard("Открыть FinCopilot"),
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
    await runWithCurrency(user.currency, () => deliverAll(user));
  }
  return result;

  async function deliverAll(user: ScheduledUser) {
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
      // Страховка: цель могла закрыться переводом, который бот не видел
      await notifyGoalsReached(user.id);
      await maybeSendTrialReminder(bot, user);
      await maybeSendWinback(bot, user);
    } else if (user.eveningDigest) {
      await deliver(user, "lastEveningOn", () => buildEvening(user));
    }
  }
}
