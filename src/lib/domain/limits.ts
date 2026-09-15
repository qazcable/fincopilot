// Лимиты расходов по категориям на календарный месяц

export const LIMIT_LEVELS = [80, 100] as const;
export type LimitLevel = (typeof LIMIT_LEVELS)[number];

export type LimitProgress = {
  spent: number;
  limit: number;
  left: number;
  // Процент использования, округлённый вниз (может быть больше 100)
  percent: number;
  state: "ok" | "warn" | "over";
};

export function limitProgress(spent: number, limit: number): LimitProgress {
  const percent = limit > 0 ? Math.floor((spent / limit) * 100) : 0;
  return {
    spent,
    limit,
    left: limit - spent,
    percent,
    state: spent > limit ? "over" : percent >= 80 ? "warn" : "ok",
  };
}

/** Пороги, которые уже достигнуты при данной сумме расходов (по возрастанию) */
export function reachedLevels(spent: number, limit: number): LimitLevel[] {
  if (limit <= 0) return [];
  return LIMIT_LEVELS.filter(level => spent * 100 >= limit * level);
}

export function monthKeyOf(dayKey: string) {
  return dayKey.slice(0, 7);
}
