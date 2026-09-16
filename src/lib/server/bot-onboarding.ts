import "server-only";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "./prisma";
import { getBudgetSnapshot } from "./overview";
import { runWithCurrency } from "./currency-context";
import { finishOnboarding, rewardInviter } from "./onboarding";
import { escapeHtml } from "./receipt";
import { h, lines, mainKeyboard, muted } from "./botui";
import { setupCard } from "@/lib/domain/cards";
import { CURRENCIES, isCurrencyCode, type CurrencyCode } from "@/lib/domain/currency";
import { formatMoney, parseAmount } from "@/lib/domain/money";
import { ONBOARDING_CURRENCIES, parseBalanceInput, parseDay, type BotOnboardingData, type BotOnboardingStep } from "@/lib/domain/onboarding";
import type { BotMessage } from "./digests";
import type { EffectName } from "@/lib/domain/botui";

type State = BotOnboardingData & { messageId?: number };

export type OnboardingHelpers = {
  userFromContext: (ctx: Context) => Promise<User | null>;
  sendBotMessage: (
    api: Bot["api"],
    chatId: string | number,
    message: BotMessage,
    options: { cards: boolean; markup?: InlineKeyboard; effect?: EffectName },
  ) => Promise<unknown>;
  appUrl: () => string | null;
};

const stateOf = (user: User): State => (user.botOnboardingData as State | null) ?? {};

function currencyOf(user: User, state: State): CurrencyCode {
  return state.currency ?? (isCurrencyCode(user.currency) ? user.currency : "KZT");
}

async function saveStep(userId: string, step: BotOnboardingStep | null, state: State) {
  await prisma.user.update({
    where: { id: userId },
    data: { botOnboardingStep: step, botOnboardingData: step ? (state as Prisma.InputJsonValue) : Prisma.DbNull },
  });
}

// ── Экраны ───────────────────────────────────────────────

function introView(user: User, helpers: OnboardingHelpers) {
  const keyboard = new InlineKeyboard().text("Начать", "ob:go").style("primary");
  const url = helpers.appUrl();
  if (url) keyboard.row().webApp("Настрою в приложении", url);
  return {
    text: lines(
      `Привет${user.firstName ? `, ${escapeHtml(user.firstName)}` : ""} 👋`,
      "Я FinCopilot — каждый день считаю, сколько можно тратить, чтобы деньги дожили до зарплаты.",
      "",
      "Настроим за 30 секунд — всего два вопроса.",
    ),
    keyboard,
  };
}

function balanceView(currency: CurrencyCode) {
  const info = CURRENCIES[currency];
  return {
    text: lines(
      h("Сколько сейчас на карте?"),
      "Напишите сумму — например, <code>185 000</code>.",
      muted(`Валюта: ${info.flag} ${info.name}`),
    ),
    keyboard: new InlineKeyboard()
      .text("Пусто — 0", "ob:b0").text("Другая валюта", "ob:cur").row()
      .text("Пропустить", "ob:bs"),
  };
}

function currencyKeyboard(current: CurrencyCode) {
  const keyboard = new InlineKeyboard();
  ONBOARDING_CURRENCIES.forEach((code, index) => {
    keyboard.text(`${code === current ? "✓ " : ""}${CURRENCIES[code].flag} ${code}`, `ob:c:${code}`);
    if (index % 3 === 2) keyboard.row();
  });
  return keyboard.row().text("← Назад", "ob:bk");
}

function dayView() {
  const keyboard = new InlineKeyboard();
  for (let day = 1; day <= 31; day++) {
    keyboard.text(String(day), `ob:d:${day}`);
    if (day % 7 === 0) keyboard.row();
  }
  keyboard.row().text("Нет постоянной зарплаты", "ob:d:0").row().text("← Назад", "ob:bb");
  return {
    text: lines(
      h("Когда приходит зарплата?"),
      "Лимит рассчитаю так, чтобы денег хватило до этого дня.",
    ),
    keyboard,
  };
}

function amountView() {
  return {
    text: lines(
      h("Сколько примерно приходит?"),
      "Напишите сумму — нужна для прогноза остатка.",
      muted("Можно пропустить и указать позже."),
    ),
    keyboard: new InlineKeyboard().text("Пропустить", "ob:as").style("primary"),
  };
}

// ── Переходы ─────────────────────────────────────────────

/** Первое сообщение для ненастроенного пользователя */
export async function startOnboarding(ctx: Context, user: User, helpers: OnboardingHelpers) {
  const view = introView(user, helpers);
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showStep(ctx: Context, user: User, step: BotOnboardingStep, state: State, mode: "edit" | "send") {
  const currency = currencyOf(user, state);
  const view = step === "balance" ? balanceView(currency) : step === "day" ? dayView() : amountView();
  if (mode === "edit") {
    await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard }).catch(() => undefined);
    const messageId = ctx.callbackQuery?.message?.message_id;
    await saveStep(user.id, step, { ...state, messageId });
    return;
  }
  const sent = await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  await saveStep(user.id, step, { ...state, messageId: sent.message_id });
}

/** Прошлый шаг, отвеченный текстом: убираем с него кнопки и оставляем ответ */
async function closePrevious(ctx: Context, state: State, answer: string) {
  if (!state.messageId || !ctx.chat) return;
  await ctx.api.editMessageText(ctx.chat.id, state.messageId, `✅ ${answer}`, { parse_mode: "HTML" }).catch(() => undefined);
}

async function finish(ctx: Context, user: User, state: State, incomeAmount: number | null, helpers: OnboardingHelpers) {
  const currency = currencyOf(user, state);
  const result = await finishOnboarding(user.id, {
    balance: state.balance ?? 0,
    incomeDay: state.day ?? null,
    incomeAmount,
    currency,
  });
  if (!result.ok || !result.firstTime) {
    await ctx.reply(result.ok ? "Уже настроено ✅" : result.error);
    return;
  }

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const chatId = ctx.chat!.id;
  await runWithCurrency(fresh.currency, async () => {
    const snapshot = await getBudgetSnapshot(fresh);
    const url = helpers.appUrl();
    const keyboard = new InlineKeyboard();
    if (url) keyboard.webApp("Открыть приложение", url).style("primary");
    await helpers.sendBotMessage(ctx.api, chatId, {
      text: lines(
        "Готово ✅",
        `Сегодня можно ${h(formatMoney(Math.max(0, snapshot.budget.leftToday)))}`,
        result.trialStarted ? muted("Pro открыт на 14 дней — всё без ограничений.") : null,
      ),
      card: setupCard({
        firstName: fresh.firstName,
        today: snapshot.today,
        horizon: snapshot.horizon,
        hasIncomeSchedule: snapshot.hasIncomeSchedule,
        leftToday: snapshot.budget.leftToday,
        daysLeft: snapshot.budget.daysLeft,
        trial: result.trialStarted,
      }),
    }, { cards: fresh.digestCards, markup: url ? keyboard : undefined, effect: "confetti" });
  });

  // Нижняя клавиатура приходит отдельным сообщением: у одного сообщения может быть только одна клавиатура
  await ctx.reply(
    lines(
      "Первая запись — прямо сейчас:",
      "напишите <code>кофе 1200</code> или скажите голосом 🎙",
      "",
      muted("Каждое утро пришлю лимит на день, вечером — итоги."),
    ),
    { parse_mode: "HTML", reply_markup: mainKeyboard() },
  );

  await rewardInviter(user.id);
}

export function registerOnboarding(bot: Bot, helpers: OnboardingHelpers) {
  // Ответы текстом на шагах настройки — раньше записи трат и советника
  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user?.botOnboardingStep || user.onboardedAt) return next();
    const text = ctx.message.text;
    if (text?.startsWith("/")) return next();
    if (!text) {
      await ctx.reply("Сейчас нужна сумма цифрами 🙂");
      return;
    }

    const state = stateOf(user);
    const step = user.botOnboardingStep as BotOnboardingStep;
    const currency = currencyOf(user, state);

    await runWithCurrency(currency, async () => {
      if (step === "balance") {
        const balance = parseBalanceInput(text);
        if (balance === null) {
          await ctx.reply("Не понял сумму. Напишите число, например <code>185 000</code>", { parse_mode: "HTML" });
          return;
        }
        await closePrevious(ctx, state, `На карте: ${h(formatMoney(balance))}`);
        await showStep(ctx, user, "day", { ...state, balance, currency }, "send");
        return;
      }
      if (step === "day") {
        const day = parseDay(text);
        if (day === null) {
          await ctx.reply("Нажмите число ниже или напишите день от 1 до 31.");
          return;
        }
        await closePrevious(ctx, state, `Зарплата ${h(`${day}-го`)}`);
        await showStep(ctx, user, "amount", { ...state, day }, "send");
        return;
      }
      const amount = parseAmount(text.replace(/[₸$€₽]|тенге|тг\.?/gi, "").trim());
      if (amount === null) {
        await ctx.reply("Не понял сумму. Напишите число или нажмите «Пропустить».");
        return;
      }
      await closePrevious(ctx, state, `Приходит около ${h(formatMoney(amount))}`);
      await finish(ctx, user, state, amount, helpers);
    });
  });

  bot.callbackQuery(/^ob:(.+)$/, async ctx => {
    const user = await helpers.userFromContext(ctx);
    if (!user) return;
    if (user.onboardedAt) {
      await ctx.answerCallbackQuery("Уже настроено ✅");
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      return;
    }
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    const state = stateOf(user);
    const currency = currencyOf(user, state);

    await runWithCurrency(currency, async () => {
      if (action === "go" || action === "bk") {
        await showStep(ctx, user, "balance", { ...state, currency }, "edit");
        return;
      }
      if (action === "cur") {
        await ctx.editMessageReplyMarkup({ reply_markup: currencyKeyboard(currency) }).catch(() => undefined);
        return;
      }
      if (action.startsWith("c:")) {
        const code = action.slice(2);
        if (isCurrencyCode(code)) await runWithCurrency(code, () => showStep(ctx, user, "balance", { ...state, currency: code }, "edit"));
        return;
      }
      if (action === "b0" || action === "bs") {
        await showStep(ctx, user, "day", { ...state, balance: 0, currency }, "edit");
        return;
      }
      if (action === "bb") {
        await showStep(ctx, user, "balance", state, "edit");
        return;
      }
      if (action.startsWith("d:")) {
        const day = Number(action.slice(2));
        if (day === 0) {
          await ctx.editMessageText("✅ Постоянной зарплаты нет — считаю до конца месяца").catch(() => undefined);
          await finish(ctx, user, { ...state, day: null }, null, helpers);
          return;
        }
        if (day < 1 || day > 31) return;
        await showStep(ctx, user, "amount", { ...state, day }, "edit");
        return;
      }
      if (action === "as") {
        await ctx.editMessageText("✅ Сумму зарплаты можно указать позже в настройках").catch(() => undefined);
        await finish(ctx, user, state, null, helpers);
      }
    });
  });
}
