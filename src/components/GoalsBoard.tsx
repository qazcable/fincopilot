"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { Sheet } from "./ui/Sheet";
import { Button, Card, EmptyState, Field, Money, inputClass } from "./ui/primitives";
import { deleteGoal, saveGoal } from "@/lib/actions/goals";
import { formatDayKey } from "@/lib/domain/dates";
import { minorToInput, parseAmount } from "@/lib/domain/money";
import type { GoalSummary } from "@/lib/domain/goals";
import { haptic } from "@/lib/client/telegram";
import { useCurrency } from "./CurrencyProvider";

export type GoalAccount = { id: string; name: string; balance: number };

const EMOJIS = ["🎯", "🏦", "🛟", "🏠", "🚗", "✈️", "🎓", "📱", "💍", "🎁"];

export function goalPlanText(goal: GoalSummary, today: string, symbol: string) {
  switch (goal.plan.status) {
    case "done": return "Цель достигнута 🎉";
    case "no_deadline": return "Без срока — откладывайте сколько получится";
    case "overdue": return `Срок ${formatDayKey(goal.targetDate!)} прошёл`;
    case "on_track": {
      const payments = goal.plan.incomesLeft + 1;
      return payments === 1
        ? `Отложить до ${formatDayKey(goal.targetDate!, today).toLowerCase()}`
        // План на период не «плывёт» после перевода внутри периода
        : `${formatPlain(goal.plannedThisPeriod || goal.plan.perIncome)} ${symbol} с каждой зарплаты`;
    }
  }
}

function formatPlain(minor: number) {
  return Math.round(minor / 100).toLocaleString("ru-RU");
}

export function GoalProgress({ goal, today, compact = false }: { goal: GoalSummary; today: string; compact?: boolean }) {
  const done = goal.plan.status === "done";
  const { symbol } = useCurrency();
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl" aria-hidden>{goal.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{goal.title}</p>
          <p className="truncate text-[13px] text-muted">{goalPlanText(goal, today, symbol)}</p>
        </div>
        <span className={clsx("text-[15px] font-bold tabular", done ? "text-positive" : "text-fg")}>{goal.percent}%</span>
      </div>
      <div className={clsx("overflow-hidden rounded-full bg-surface-2", compact ? "mt-3 h-1.5" : "mt-3.5 h-2")}>
        <div className={clsx("h-full rounded-full transition-all duration-700", done ? "bg-positive" : "bg-accent")} style={{ width: `${goal.percent}%` }} />
      </div>
      {!compact && (
        <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
          <span><Money value={goal.saved} className="font-medium text-fg" /> из <Money value={goal.targetAmount} /></span>
          {goal.targetDate && <span>до {formatDayKey(goal.targetDate)} {goal.targetDate.slice(0, 4)}</span>}
        </div>
      )}
    </div>
  );
}

export function GoalsBoard({
  goals,
  accounts,
  today,
  reservedForGoals,
}: { goals: GoalSummary[]; accounts: GoalAccount[]; today: string; reservedForGoals: number }) {
  const [editing, setEditing] = useState<GoalSummary | "new" | null>(null);
  const [formKey, setFormKey] = useState(0);

  function open(goal: GoalSummary | "new") {
    haptic.tap();
    setFormKey(k => k + 1);
    setEditing(goal);
  }

  return (
    <>
      <div className="space-y-6 px-4">
        {goals.length === 0 ? (
          <Card>
            <EmptyState emoji="🎯" title="Поставьте первую цель" text="Например, «Подушка на депозите — 1 000 000 к декабрю». Я посчитаю, сколько откладывать с каждой зарплаты, и учту это в лимите на день.">
              <Button onClick={() => open("new")}>Создать цель</Button>
            </EmptyState>
          </Card>
        ) : (
          <>
            {reservedForGoals > 0 && (
              <Card className="p-4">
                <p className="text-[13px] font-medium text-muted">Отложить до следующей зарплаты</p>
                <Money value={reservedForGoals} className="mt-1 block text-[24px] font-bold tracking-tight" />
                <p className="mt-1 text-[12px] leading-snug text-faint">Уже вычтено из лимита на день. Переведите на счёт накоплений — и сумма уменьшится.</p>
              </Card>
            )}
            <div className="space-y-3">
              {goals.map(goal => (
                <button key={goal.id} type="button" onClick={() => open(goal)} className="pressable block w-full text-left">
                  <Card className="p-4"><GoalProgress goal={goal} today={today} /></Card>
                </button>
              ))}
            </div>
            <Button variant="soft" size="md" className="w-full" onClick={() => open("new")}>
              <Plus className="size-4" /> Новая цель
            </Button>
          </>
        )}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Новая цель" : "Цель"}>
        {editing !== null && (
          <GoalForm key={formKey} goal={editing === "new" ? null : editing} accounts={accounts} today={today} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </>
  );
}

function GoalForm({ goal, accounts, today, onDone }: { goal: GoalSummary | null; accounts: GoalAccount[]; today: string; onDone: () => void }) {
  const { symbol } = useCurrency();
  const [emoji, setEmoji] = useState(goal?.emoji ?? "🎯");
  const [title, setTitle] = useState(goal?.title ?? "");
  const [target, setTarget] = useState(minorToInput(goal?.targetAmount));
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? accounts[0]?.id ?? null);
  const [newName, setNewName] = useState("Kaspi Депозит");
  const [newBalance, setNewBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const creatingAccount = accountId === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const targetAmount = parseAmount(target);
    const balance = newBalance.trim() ? parseAmount(newBalance) : 0;
    const problem =
      !title.trim() ? "Укажите название" :
      !targetAmount ? "Укажите сумму цели" :
      creatingAccount && !newName.trim() ? "Укажите название счёта" :
      creatingAccount && balance === null ? "Проверьте, сколько уже накоплено" :
      null;
    if (problem) {
      haptic.error();
      setError(problem);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveGoal({
        id: goal?.id,
        emoji,
        title,
        targetAmount: targetAmount!,
        targetDate: date || null,
        accountId,
        newAccount: creatingAccount ? { name: newName, balance: balance ?? 0 } : null,
      });
      if (result.ok) {
        haptic.success();
        onDone();
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  function remove() {
    if (!goal) return;
    startDeleting(async () => {
      const result = await deleteGoal(goal.id);
      if (result.ok) {
        haptic.success();
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {EMOJIS.map(item => (
          <button
            key={item}
            type="button"
            onClick={() => { haptic.select(); setEmoji(item); }}
            className={clsx("pressable flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl", emoji === item ? "bg-accent-soft ring-2 ring-accent/50" : "bg-surface-2")}
            aria-label={`Значок ${item}`}
          >
            {item}
          </button>
        ))}
      </div>

      <Field label="Название">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Подушка безопасности" maxLength={60} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Сумма, ${symbol}`}>
          <input value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" placeholder="1 000 000" className={clsx(inputClass, "tabular")} />
        </Field>
        <Field label="К дате" hint="Необязательно">
          <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div>
        <span className="mb-1.5 block px-1 text-[13px] font-medium text-muted">Где копите</span>
        <div className="flex flex-wrap gap-2">
          {accounts.map(account => (
            <button
              key={account.id}
              type="button"
              onClick={() => { haptic.select(); setAccountId(account.id); }}
              className={clsx("pressable rounded-full px-3.5 py-2 text-[13px] font-medium", accountId === account.id ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}
            >
              {account.name} · <Money value={account.balance} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => { haptic.select(); setAccountId(null); }}
            className={clsx("pressable rounded-full px-3.5 py-2 text-[13px] font-medium", creatingAccount ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}
          >
            + Новый счёт
          </button>
        </div>
      </div>

      {creatingAccount && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Название счёта">
            <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={40} className={inputClass} />
          </Field>
          <Field label={`Уже накоплено, ${symbol}`}>
            <input value={newBalance} onChange={e => setNewBalance(e.target.value)} inputMode="decimal" placeholder="0" className={clsx(inputClass, "tabular")} />
          </Field>
        </div>
      )}
      <p className="px-1 text-[12px] leading-snug text-faint">
        Прогресс — это баланс счёта накоплений. Пополнения записывайте переводом «Карта → {creatingAccount ? newName || "счёт" : accounts.find(a => a.id === accountId)?.name ?? "счёт"}», а из выписки Kaspi они подтянутся сами.
      </p>

      {error && <p className="text-center text-[14px] font-medium text-negative">{error}</p>}

      <div className={clsx("grid gap-2", goal ? "grid-cols-[auto_1fr]" : "grid-cols-1")}>
        {goal && (
          <Button variant="danger" size="icon" onClick={remove} loading={deleting} aria-label="Удалить цель">
            <Trash2 className="size-5" />
          </Button>
        )}
        <Button type="submit" size="lg" loading={saving}>{goal ? "Сохранить" : "Создать цель"}</Button>
      </div>
    </form>
  );
}
