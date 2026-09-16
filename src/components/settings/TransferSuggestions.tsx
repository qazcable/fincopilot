"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight } from "lucide-react";
import { SectionHeader, Button, Money } from "../ui/primitives";
import { dismissTransfersAction, linkTransfersAction } from "@/lib/actions/imports";
import { formatDayKeyShort } from "@/lib/domain/dates";
import { haptic } from "@/lib/client/telegram";

export type TransferSuggestion = {
  outId: string;
  incomingId: string;
  amount: number;
  day: string;
  fromAccount: string;
  toAccount: string;
  note: string;
};

/**
 * Пары «ушло с одной карты — пришло на другую», которые банк описал обезличенно.
 * Наверняка знает только пользователь, поэтому связываем по подтверждению.
 */
export function TransferSuggestions({ suggestions }: { suggestions: TransferSuggestion[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const visible = suggestions.filter(s => !hidden.includes(s.outId));
  if (visible.length === 0) return null;

  const total = visible.reduce((sum, s) => sum + s.amount, 0);

  function link(items: TransferSuggestion[]) {
    haptic.tap();
    start(async () => {
      const result = await linkTransfersAction(items.map(s => s.outId));
      if (result.ok) {
        haptic.success();
        setHidden(current => [...current, ...items.map(s => s.outId)]);
      } else {
        setError(result.error);
      }
    });
  }

  function dismiss(items: TransferSuggestion[]) {
    haptic.tap();
    start(async () => {
      await dismissTransfersAction(items.flatMap(s => [s.outId, s.incomingId]));
      setHidden(current => [...current, ...items.map(s => s.outId)]);
    });
  }

  return (
    <section>
      <SectionHeader title="Переводы между своими картами" />
      <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-warning-soft text-warning">
            <ArrowLeftRight className="size-5" />
          </span>
          <p className="text-[14px] leading-snug text-muted">
            Похоже, это ваши переводы с карты на карту — банк не указал получателя. Пока они считаются расходом и доходом
            и завышают статистику. Свяжите их — и они станут одним переводом.
          </p>
        </div>

        <div className="divide-y divide-line rounded-2xl bg-surface-2 px-3">
          {visible.map(item => (
            <div key={item.outId} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{item.fromAccount} → {item.toAccount}</span>
                <span className="block truncate text-[12px] text-muted">{formatDayKeyShort(item.day)} · {item.note}</span>
              </span>
              <Money value={item.amount} className="shrink-0 text-[15px] font-semibold" />
              <button
                type="button"
                onClick={() => link([item])}
                disabled={pending}
                className="pressable shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent disabled:opacity-50"
              >
                Связать
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-center text-[13px] font-medium text-negative">{error}</p>}

        <div className="grid gap-2">
          <Button loading={pending} onClick={() => link(visible)}>
            Связать все · <Money value={total} />
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => dismiss(visible)}>Это не мои переводы</Button>
        </div>
      </div>
    </section>
  );
}
