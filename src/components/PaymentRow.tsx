"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { Check, MoreHorizontal } from "lucide-react";
import { CategoryIcon, Money } from "./ui/primitives";
import { Sheet } from "./ui/Sheet";
import { Button } from "./ui/primitives";
import { payScheduledPayment, skipScheduledPayment } from "@/lib/actions/payments";
import { capitalize, daysBetween, formatDayKey, formatDayKeyShort, relativeDays } from "@/lib/domain/dates";
import { OBLIGATION_KINDS, type ObligationKind } from "@/lib/domain/constants";
import { haptic } from "@/lib/client/telegram";

export type PaymentDto = { id: string; dueOn: string; amount: number; title: string; kind: string };

const KIND_COLOR: Record<string, string> = {
  LOAN: "#6366F1",
  CREDIT_CARD: "#0EA5E9",
  INSTALLMENT: "#F59E0B",
  BILL: "#10B981",
};

export function PaymentRow({ payment, today }: { payment: PaymentDto; today: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paying, startPaying] = useTransition();
  const [skipping, startSkipping] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const diff = daysBetween(today, payment.dueOn);
  const overdue = diff < 0;
  const soon = diff >= 0 && diff <= 2;
  const kind = OBLIGATION_KINDS[payment.kind as ObligationKind];

  function pay() {
    startPaying(async () => {
      const result = await payScheduledPayment(payment.id);
      if (result.ok) {
        haptic.success();
        setMenuOpen(false);
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  function skip() {
    startSkipping(async () => {
      const result = await skipScheduledPayment(payment.id);
      if (result.ok) setMenuOpen(false);
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={() => { haptic.tap(); setMenuOpen(true); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <CategoryIcon emoji={kind?.emoji ?? "🧾"} color={KIND_COLOR[payment.kind] ?? "#64748B"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{payment.title}</span>
            <span className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className={clsx("truncate text-[13px]", overdue ? "font-medium text-negative" : soon ? "font-medium text-warning" : "text-muted")}>
                {diff >= 0 && diff <= 7 ? `${capitalize(relativeDays(diff))} · ${formatDayKeyShort(payment.dueOn)}` : overdue ? capitalize(relativeDays(diff)) : formatDayKeyShort(payment.dueOn)}
              </span>
              <Money value={payment.amount} className="text-[14px] font-semibold" />
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={pay}
          disabled={paying}
          aria-label={`Отметить «${payment.title}» оплаченным`}
          className="pressable flex size-9 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive disabled:opacity-50"
        >
          <Check className={clsx("size-[18px]", paying && "animate-pulse")} strokeWidth={2.6} />
        </button>
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={payment.title}>
        <div className="space-y-4">
          <div className="rounded-3xl bg-surface-2 p-5 text-center">
            <Money value={payment.amount} className="text-[36px] font-bold tracking-tight" />
            <p className={clsx("mt-1 text-[14px]", overdue ? "text-negative" : "text-muted")}>
              {formatDayKey(payment.dueOn)} · {relativeDays(diff)}
            </p>
          </div>
          <p className="px-1 text-[14px] leading-snug text-muted">
            При отметке «Оплачено» появится расход с основного счёта{kind?.hasPrincipal ? ", а остаток долга уменьшится" : ""}. Отменить можно, удалив операцию в истории.
          </p>
          {error && <p className="text-center text-[14px] text-negative">{error}</p>}
          <Button size="lg" className="w-full" onClick={pay} loading={paying}>
            <Check className="size-5" /> Оплачено
          </Button>
          <Button variant="secondary" size="md" className="w-full" onClick={skip} loading={skipping}>
            <MoreHorizontal className="size-4" /> Пропустить этот месяц
          </Button>
        </div>
      </Sheet>
    </>
  );
}
