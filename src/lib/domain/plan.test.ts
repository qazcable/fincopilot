import { describe, expect, it } from "vitest";
import { extendUntil, extendUntilDays, planState } from "./plan";

const NOW = new Date("2026-09-16T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe("planState", () => {
  it("бессрочный Pro у участников беты", () => {
    const state = planState({ plan: "PRO", proUntil: null, trialEndsAt: null }, NOW);
    expect(state).toMatchObject({ pro: true, kind: "forever", daysLeft: null });
  });

  it("оплаченный Pro считает дни до конца", () => {
    const state = planState({ plan: "PRO", proUntil: days(10), trialEndsAt: null }, NOW);
    expect(state.pro).toBe(true);
    expect(state.kind).toBe("paid");
    expect(state.daysLeft).toBe(10);
  });

  it("после окончания оплаты тариф снова бесплатный", () => {
    const state = planState({ plan: "PRO", proUntil: days(-1), trialEndsAt: null }, NOW);
    expect(state.pro).toBe(false);
    expect(state.kind).toBe("free");
  });

  it("пробный период работает и на бесплатном тарифе", () => {
    const state = planState({ plan: "FREE", proUntil: null, trialEndsAt: days(3) }, NOW);
    expect(state).toMatchObject({ pro: true, kind: "trial", daysLeft: 3 });
  });

  it("истёкший пробный период не даёт Pro", () => {
    const state = planState({ plan: "FREE", proUntil: null, trialEndsAt: days(-3) }, NOW);
    expect(state.pro).toBe(false);
  });
});

describe("extendUntil", () => {
  it("новая подписка считается от сегодня", () => {
    expect(extendUntil(null, 1, NOW)).toEqual(new Date("2026-10-16T10:00:00Z"));
  });

  it("продление добавляется к действующей подписке", () => {
    expect(extendUntil(new Date("2026-12-01T10:00:00Z"), 12, NOW)).toEqual(new Date("2027-12-01T10:00:00Z"));
  });

  it("истёкшая подписка продлевается от сегодня", () => {
    expect(extendUntil(new Date("2026-01-01T10:00:00Z"), 1, NOW)).toEqual(new Date("2026-10-16T10:00:00Z"));
  });
});

describe("extendUntilDays", () => {
  it("бонус без подписки считается от сегодня", () => {
    expect(extendUntilDays(null, 14, NOW)).toEqual(new Date("2026-09-30T10:00:00Z"));
  });

  it("бонус добавляется к действующему пробному периоду или подписке", () => {
    expect(extendUntilDays(days(5), 14, NOW)).toEqual(days(19));
  });

  it("бонус на истёкший период считается от сегодня, а не от старой даты", () => {
    expect(extendUntilDays(days(-30), 14, NOW)).toEqual(new Date("2026-09-30T10:00:00Z"));
  });
});
