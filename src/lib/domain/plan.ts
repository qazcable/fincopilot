// Тарифы FinCopilot. Цены меняются здесь — и сразу везде: в боте, приложении и инструкции.

export const PRICE = {
  /** Pro на месяц, в тенге */
  monthly: 1490,
  /** Pro на год, в тенге (скидка 28% к месячной) */
  yearly: 12900,
  currency: "₸",
} as const;

/** Бесплатный пробный период Pro для новых пользователей */
export const TRIAL_DAYS = 14;

/** Что можно на бесплатном тарифе */
export const FREE_LIMITS = {
  /** Записей голосом и текстом в месяц (ручной ввод в приложении — без ограничений) */
  aiPerMonth: 20,
  /** Сколько выписок банка можно импортировать всего */
  imports: 1,
} as const;

export type PlanUser = {
  plan: string;
  proUntil: Date | null;
  trialEndsAt: Date | null;
};

export type PlanState = {
  pro: boolean;
  /** forever — бессрочный Pro (беты и близкие), paid — оплаченный, trial — пробный, free — бесплатный тариф */
  kind: "forever" | "paid" | "trial" | "free";
  until: Date | null;
  /** Сколько дней осталось до конца оплаченного или пробного периода */
  daysLeft: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function planState(user: PlanUser, now = new Date()): PlanState {
  const days = (until: Date) => Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));

  if (user.plan === "PRO") {
    if (user.proUntil === null) return { pro: true, kind: "forever", until: null, daysLeft: null };
    if (user.proUntil > now) return { pro: true, kind: "paid", until: user.proUntil, daysLeft: days(user.proUntil) };
  }
  if (user.trialEndsAt && user.trialEndsAt > now) {
    return { pro: true, kind: "trial", until: user.trialEndsAt, daysLeft: days(user.trialEndsAt) };
  }
  return { pro: false, kind: "free", until: user.proUntil, daysLeft: null };
}

/** Новая дата окончания подписки: продлеваем от большей из дат — текущей подписки или сегодня */
export function extendUntil(current: Date | null, months: number, now = new Date()) {
  const from = current && current > now ? new Date(current) : new Date(now);
  from.setMonth(from.getMonth() + months);
  return from;
}

export function priceText() {
  return `${PRICE.monthly.toLocaleString("ru-RU")} ${PRICE.currency} в месяц или ${PRICE.yearly.toLocaleString("ru-RU")} ${PRICE.currency} в год`;
}

export function planLabel(state: PlanState) {
  switch (state.kind) {
    case "forever": return "Pro";
    case "paid": return `Pro до ${state.until!.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
    case "trial": return `Пробный Pro, ${state.daysLeft} ${plural(state.daysLeft!, "день", "дня", "дней")}`;
    case "free": return "Бесплатный";
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
