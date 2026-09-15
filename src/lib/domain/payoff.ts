// Досрочное погашение: помесячная модель «проценты на остаток, остальное — в тело долга».
// Это приближение к аннуитету: банковский график может немного отличаться.

export type PayoffResult = {
  months: number;
  totalInterest: number;
  totalPaid: number;
  // false — платёж не покрывает проценты, долг не уменьшается
  feasible: boolean;
};

const MAX_MONTHS = 600;

export function simulatePayoff(balance: number, annualRatePercent: number, monthlyPayment: number, extraPerMonth = 0, lumpSum = 0): PayoffResult {
  const rate = Math.max(0, annualRatePercent) / 100 / 12;
  let left = Math.max(0, balance - lumpSum);
  let months = 0;
  let totalInterest = 0;
  let totalPaid = Math.min(balance, lumpSum);
  const payment = monthlyPayment + extraPerMonth;

  while (left > 0 && months < MAX_MONTHS) {
    const interest = Math.round(left * rate);
    if (payment <= interest) return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, feasible: false };
    const pay = Math.min(payment, left + interest);
    left = left + interest - pay;
    totalInterest += interest;
    totalPaid += pay;
    months++;
  }
  return { months, totalInterest, totalPaid, feasible: left <= 0 };
}

export type Debt = { id: string; title: string; balance: number; ratePercent: number; minPayment: number };

export type StrategyResult = {
  months: number;
  totalInterest: number;
  // Порядок, в котором долги закрываются
  order: { id: string; title: string; month: number }[];
  feasible: boolean;
};

/**
 * Все долги: минимальные платежи по каждому, а свободные деньги (доплата + платежи закрытых долгов)
 * идут на приоритетный долг. avalanche — сначала самая высокая ставка, snowball — самый маленький остаток.
 */
export function simulateStrategy(debts: Debt[], extraPerMonth: number, strategy: "avalanche" | "snowball"): StrategyResult {
  const state = debts.map(d => ({ ...d, left: d.balance }));
  const priority = [...state].sort((a, b) =>
    strategy === "avalanche" ? b.ratePercent - a.ratePercent || a.left - b.left : a.left - b.left || b.ratePercent - a.ratePercent
  );
  const budget = debts.reduce((sum, d) => sum + d.minPayment, 0) + extraPerMonth;
  const order: StrategyResult["order"] = [];
  let totalInterest = 0;
  let month = 0;

  while (state.some(d => d.left > 0) && month < MAX_MONTHS) {
    month++;
    const totalBefore = state.reduce((sum, d) => sum + Math.max(0, d.left), 0);
    let available = budget;
    for (const debt of state) {
      if (debt.left <= 0) continue;
      const interest = Math.round(debt.left * (debt.ratePercent / 100 / 12));
      debt.left += interest;
      totalInterest += interest;
    }
    // Сначала минимальные платежи
    for (const debt of state) {
      if (debt.left <= 0) continue;
      const pay = Math.min(debt.minPayment, debt.left, available);
      debt.left -= pay;
      available -= pay;
    }
    // Остаток — по приоритету
    for (const target of priority) {
      const debt = state.find(d => d.id === target.id)!;
      if (debt.left <= 0 || available <= 0) continue;
      const pay = Math.min(debt.left, available);
      debt.left -= pay;
      available -= pay;
    }
    for (const debt of state) {
      if (debt.left <= 0 && !order.some(o => o.id === debt.id)) order.push({ id: debt.id, title: debt.title, month });
    }
    // Долг не уменьшается (платежи не покрывают проценты) — дальше считать нет смысла
    const totalAfter = state.reduce((sum, d) => sum + Math.max(0, d.left), 0);
    if (totalAfter > 0 && totalAfter >= totalBefore) break;
  }
  const feasible = state.every(d => d.left <= 0);
  return { months: feasible ? month : Infinity, totalInterest: feasible ? totalInterest : Infinity, order, feasible };
}
