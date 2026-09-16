"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Sheet } from "./ui/Sheet";
import { Button, Card, Field, Money, SectionHeader, inputClass } from "./ui/primitives";
import { deleteDebt, saveDebt, settleDebt } from "@/lib/actions/debts";
import { formatDayKey } from "@/lib/domain/dates";
import { minorToInput, parseAmount } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";
import { useCurrency } from "./CurrencyProvider";

export type DebtItem = {
  id: string;
  person: string;
  direction: "OUT" | "IN";
  amount: number;
  dueOn: string | null;
  note: string | null;
  settled: boolean;
};

export function DebtsBoard({ debts, today }: { debts: DebtItem[]; today: string }) {
  const [editing, setEditing] = useState<DebtItem | "new" | null>(null);
  const [formKey, setFormKey] = useState(0);
  const open = debts.filter(d => !d.settled);
  const closed = debts.filter(d => d.settled);
  const iOwe = open.filter(d => d.direction === "OUT").reduce((sum, d) => sum + d.amount, 0);
  const owedToMe = open.filter(d => d.direction === "IN").reduce((sum, d) => sum + d.amount, 0);

  function edit(debt: DebtItem | "new") {
    haptic.tap();
    setFormKey(k => k + 1);
    setEditing(debt);
  }

  return (
    <section>
      <SectionHeader title="Долги людям" />
      <div className="space-y-3">
        {open.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-[13px] font-medium text-muted">Я должен</p>
              <Money value={iOwe} className="mt-1 block text-[20px] font-bold tracking-tight text-negative" />
            </Card>
            <Card className="p-4">
              <p className="text-[13px] font-medium text-muted">Мне должны</p>
              <Money value={owedToMe} className="mt-1 block text-[20px] font-bold tracking-tight text-positive" />
            </Card>
          </div>
        )}

        {debts.length === 0 ? (
          <Card className="p-4">
            <p className="text-[14px] leading-snug text-muted">
              Заняли другу или взяли в долг сами? Запишите — приложение будет помнить сумму, имя и срок возврата.
            </p>
          </Card>
        ) : (
          <Card className="p-1.5">
            {[...open, ...closed].map(debt => <DebtRow key={debt.id} debt={debt} today={today} onEdit={() => edit(debt)} />)}
          </Card>
        )}

        <Button variant="soft" size="md" className="w-full" onClick={() => edit("new")}>
          <Plus className="size-4" /> Записать долг
        </Button>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Новый долг" : "Долг"}>
        {editing !== null && (
          <DebtForm key={formKey} debt={editing === "new" ? null : editing} today={today} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </section>
  );
}

function DebtRow({ debt, today, onEdit }: { debt: DebtItem; today: string; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const out = debt.direction === "OUT";
  const overdue = !debt.settled && debt.dueOn !== null && debt.dueOn < today;

  function toggle() {
    start(async () => {
      const result = await settleDebt(debt.id, !debt.settled);
      if (result.ok) haptic.success();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl px-2.5 py-2.5">
      <button type="button" onClick={onEdit} className="pressable flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={clsx("flex size-11 shrink-0 items-center justify-center rounded-2xl", debt.settled ? "bg-surface-2 text-faint" : out ? "bg-negative-soft text-negative" : "bg-positive-soft text-positive")}>
          {out ? <ArrowUpRight className="size-5" /> : <ArrowDownLeft className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx("block truncate text-[16px] font-semibold", debt.settled && "text-muted line-through")}>{debt.person}</span>
          <span className={clsx("block truncate text-[13px]", overdue ? "font-medium text-warning" : "text-muted")}>
            {debt.settled ? "Закрыт" : out ? "Я должен" : "Мне должны"}
            {debt.dueOn ? ` · до ${formatDayKey(debt.dueOn, today).toLowerCase()}` : ""}
            {debt.note ? ` · ${debt.note}` : ""}
          </span>
        </span>
        <Money value={debt.amount} className={clsx("text-[16px] font-semibold", debt.settled && "text-faint line-through")} />
      </button>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={debt.settled ? "Вернуть в долги" : "Долг закрыт"}
        className={clsx("pressable flex size-9 shrink-0 items-center justify-center rounded-full disabled:opacity-50", debt.settled ? "bg-surface-2 text-muted" : "bg-positive-soft text-positive")}
      >
        {debt.settled ? <RotateCcw className="size-4" /> : <Check className="size-5" />}
      </button>
    </div>
  );
}

function DebtForm({ debt, today, onDone }: { debt: DebtItem | null; today: string; onDone: () => void }) {
  const { symbol } = useCurrency();
  const [direction, setDirection] = useState<"OUT" | "IN">(debt?.direction ?? "OUT");
  const [person, setPerson] = useState(debt?.person ?? "");
  const [amount, setAmount] = useState(minorToInput(debt?.amount));
  const [dueOn, setDueOn] = useState(debt?.dueOn ?? "");
  const [note, setNote] = useState(debt?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const minor = parseAmount(amount);
    const problem = !person.trim() ? "Укажите имя" : !minor ? "Укажите сумму" : null;
    if (problem) {
      haptic.error();
      setError(problem);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveDebt({ id: debt?.id, person, direction, amount: minor!, dueOn: dueOn || null, note: note.trim() || null });
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
    if (!debt) return;
    startDeleting(async () => {
      const result = await deleteDebt(debt.id);
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
      <div className="grid grid-cols-2 gap-2">
        {([["OUT", "Я должен"], ["IN", "Мне должны"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { haptic.select(); setDirection(value); }}
            className={clsx("pressable h-11 rounded-2xl text-[15px] font-semibold", direction === value ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      <Field label={direction === "OUT" ? "Кому должен" : "Кто должен"}>
        <input value={person} onChange={e => setPerson(e.target.value)} placeholder="Имя" maxLength={40} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Сумма, ${symbol}`}>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="50 000" className={clsx(inputClass, "tabular")} />
        </Field>
        <Field label="Вернуть до" hint="Необязательно">
          <input type="date" value={dueOn} min={today} onChange={e => setDueOn(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Заметка" hint="Необязательно">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="за ремонт" maxLength={120} className={inputClass} />
      </Field>

      {error && <p className="text-center text-[14px] font-medium text-negative">{error}</p>}

      <div className={clsx("grid gap-2", debt ? "grid-cols-[auto_1fr]" : "grid-cols-1")}>
        {debt && (
          <Button variant="danger" size="icon" onClick={remove} loading={deleting} aria-label="Удалить долг">
            <Trash2 className="size-5" />
          </Button>
        )}
        <Button type="submit" size="lg" loading={saving}>{debt ? "Сохранить" : "Записать"}</Button>
      </div>
    </form>
  );
}
