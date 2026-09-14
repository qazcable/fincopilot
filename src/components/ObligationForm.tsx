"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { Button, Field, inputClass } from "./ui/primitives";
import { Sheet } from "./ui/Sheet";
import { deleteObligation, saveObligation } from "@/lib/actions/payments";
import { OBLIGATION_KINDS, type ObligationKind } from "@/lib/domain/constants";
import { minorToInput, parseAmount } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";

export type ObligationFormValues = {
  id?: string;
  kind: ObligationKind;
  title: string;
  monthlyAmount: number | null;
  dueDay: number | null;
  principalLeft: number | null;
  principalTotal: number | null;
  interestRate: number | null;
  graceUntil: string | null;
};

const PLACEHOLDERS: Record<ObligationKind, string> = {
  LOAN: "Кредит Halyk",
  CREDIT_CARD: "Kaspi Red",
  INSTALLMENT: "Рассрочка на телефон",
  BILL: "Коммунальные услуги",
};

export function ObligationForm({ initial }: { initial?: ObligationFormValues }) {
  const router = useRouter();
  const [kind, setKind] = useState<ObligationKind>(initial?.kind ?? "LOAN");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [monthly, setMonthly] = useState(minorToInput(initial?.monthlyAmount));
  const [dueDay, setDueDay] = useState(initial?.dueDay ? String(initial.dueDay) : "");
  const [left, setLeft] = useState(minorToInput(initial?.principalLeft));
  const [total, setTotal] = useState(minorToInput(initial?.principalTotal));
  const [rate, setRate] = useState(initial?.interestRate != null ? String(initial.interestRate).replace(".", ",") : "");
  const [grace, setGrace] = useState(initial?.graceUntil ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const hasPrincipal = OBLIGATION_KINDS[kind].hasPrincipal;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const monthlyAmount = parseAmount(monthly);
    const day = Number(dueDay);
    const principalLeft = hasPrincipal ? parseAmount(left) : null;
    const principalTotal = hasPrincipal && total.trim() ? parseAmount(total) : null;
    const interestRate = hasPrincipal && rate.trim() ? Number(rate.replace(",", ".")) : null;

    const problem =
      !title.trim() ? "Укажите название" :
      !monthlyAmount ? "Укажите сумму платежа" :
      !Number.isInteger(day) || day < 1 || day > 31 ? "День платежа — от 1 до 31" :
      hasPrincipal && !principalLeft ? "Укажите остаток долга" :
      hasPrincipal && total.trim() && !principalTotal ? "Проверьте сумму долга" :
      interestRate !== null && (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 200) ? "Ставка — от 0 до 200%" :
      null;
    if (problem) {
      haptic.error();
      setError(problem);
      return;
    }

    setError(null);
    startSaving(async () => {
      const result = await saveObligation({
        id: initial?.id,
        kind,
        title,
        monthlyAmount: monthlyAmount!,
        dueDay: day,
        principalLeft,
        principalTotal,
        interestRate,
        graceUntil: kind === "CREDIT_CARD" && grace ? grace : null,
      });
      if (result.ok) {
        haptic.success();
        router.push("/payments");
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  function remove() {
    if (!initial?.id) return;
    startDeleting(async () => {
      const result = await deleteObligation(initial.id!);
      if (result.ok) {
        haptic.success();
        router.push("/payments");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(OBLIGATION_KINDS) as ObligationKind[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => { haptic.select(); setKind(key); }}
            className={clsx(
              "pressable flex items-center gap-2.5 rounded-2xl p-3 text-left text-[14px] font-semibold transition-colors",
              kind === key ? "bg-accent-soft text-accent ring-2 ring-accent/50" : "bg-surface text-fg shadow-card"
            )}
          >
            <span className="text-xl" aria-hidden>{OBLIGATION_KINDS[key].emoji}</span>
            {OBLIGATION_KINDS[key].label}
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <Field label="Название">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={PLACEHOLDERS[kind]} maxLength={60} className={inputClass} />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Платёж в месяц, ₸">
            <input value={monthly} onChange={e => setMonthly(e.target.value)} inputMode="decimal" placeholder="25 000" className={clsx(inputClass, "tabular")} />
          </Field>
          <Field label="Число">
            <input value={dueDay} onChange={e => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="20" className={clsx(inputClass, "tabular")} />
          </Field>
        </div>
      </div>

      {hasPrincipal && (
        <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Осталось выплатить">
              <input value={left} onChange={e => setLeft(e.target.value)} inputMode="decimal" placeholder="450 000" className={clsx(inputClass, "tabular")} />
            </Field>
            <Field label="Сумма долга" hint="Для прогресса">
              <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="600 000" className={clsx(inputClass, "tabular")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ставка, %" hint="Необязательно">
              <input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="24,5" className={clsx(inputClass, "tabular")} />
            </Field>
            {kind === "CREDIT_CARD" && (
              <Field label="Льготный период до" hint="Необязательно">
                <input type="date" value={grace} onChange={e => setGrace(e.target.value)} className={inputClass} />
              </Field>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-center text-[14px] font-medium text-negative">{error}</p>}

      <Button type="submit" size="lg" className="w-full" loading={saving}>
        {initial?.id ? "Сохранить" : "Добавить"}
      </Button>

      {initial?.id && (
        <>
          <Button variant="danger" size="md" className="w-full" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Удалить
          </Button>
          <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить обязательство?">
            <p className="text-[15px] leading-snug text-muted">
              Будущие платежи и напоминания исчезнут. Уже оплаченные операции останутся в истории.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" onClick={() => setConfirmDelete(false)}>Отмена</Button>
              <Button variant="danger" size="lg" loading={deleting} onClick={remove}>Удалить</Button>
            </div>
          </Sheet>
        </>
      )}
    </form>
  );
}
