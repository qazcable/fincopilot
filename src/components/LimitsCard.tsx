"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { SlidersHorizontal, Target } from "lucide-react";
import { Sheet } from "./ui/Sheet";
import { Button, Card, Money } from "./ui/primitives";
import { saveCategoryLimits } from "@/lib/actions/settings";
import { limitProgress } from "@/lib/domain/limits";
import { formatMoney, minorToInput, parseAmount } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";
import type { LimitsOverviewItem } from "@/lib/server/limits";

const BAR_COLOR = { ok: "", warn: "var(--warning)", over: "var(--negative)" } as const;

export function LimitsCard({ items, monthLabel }: { items: LimitsOverviewItem[]; monthLabel: string }) {
  const [editing, setEditing] = useState(false);
  const withLimits = items.filter(item => item.limit !== null);

  return (
    <>
      {withLimits.length === 0 ? (
        <Card className="flex items-center gap-4 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Target className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Лимиты по категориям</p>
            <p className="text-[13px] leading-snug text-muted">Бот предупредит на 80% и 100%</p>
          </div>
          <Button variant="soft" size="sm" className="h-9 px-3.5" onClick={() => setEditing(true)}>Задать</Button>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Лимиты · {monthLabel}</h2>
            <button type="button" onClick={() => { haptic.tap(); setEditing(true); }} className="pressable flex items-center gap-1.5 text-[14px] font-medium text-accent">
              <SlidersHorizontal className="size-4" /> Настроить
            </button>
          </div>
          <div className="space-y-4">
            {withLimits
              .map(item => ({ item, progress: limitProgress(item.spent, item.limit!) }))
              .sort((a, b) => b.progress.percent - a.progress.percent)
              .map(({ item, progress }) => (
                <div key={item.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-medium"><span aria-hidden>{item.emoji}</span> {item.name}</span>
                    <span className="tabular shrink-0 text-[13px] text-muted">
                      <Money value={item.spent} className={clsx("font-semibold", progress.state === "over" ? "text-negative" : "text-fg")} /> / <Money value={item.limit!} />
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, progress.percent)}%`, backgroundColor: BAR_COLOR[progress.state] || item.color }}
                    />
                  </div>
                  <p className={clsx("mt-1.5 text-[12px]", progress.state === "over" ? "font-medium text-negative" : progress.state === "warn" ? "font-medium text-warning" : "text-muted")}>
                    {progress.state === "over"
                      ? `Превышен на ${formatMoney(-progress.left)}`
                      : `Осталось ${formatMoney(progress.left)} · ${progress.percent}%`}
                  </p>
                </div>
              ))}
          </div>
        </Card>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Лимиты на месяц">
        {editing && <LimitsForm items={items} onDone={() => setEditing(false)} />}
      </Sheet>
    </>
  );
}

function LimitsForm({ items, onDone }: { items: LimitsOverviewItem[]; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map(item => [item.id, minorToInput(item.limit)]))
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const payload: { categoryId: string; limit: number | null }[] = [];
    for (const item of items) {
      // Пустое поле или ноль — лимит снят
      const text = /^[\s0.,]*$/.test(values[item.id] ?? "") ? "" : values[item.id].trim();
      const limit = text ? parseAmount(text) : null;
      if (text && limit === null) {
        haptic.error();
        setError(`Проверьте сумму для «${item.name}»`);
        return;
      }
      if (limit !== item.limit) payload.push({ categoryId: item.id, limit });
    }
    if (payload.length === 0) return onDone();

    setError(null);
    startTransition(async () => {
      const result = await saveCategoryLimits(payload);
      if (result.ok) {
        haptic.success();
        onDone();
      } else {
        haptic.error();
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-snug text-muted">
        Сколько вы готовы тратить в месяц на каждую категорию. Пустое поле — без лимита. Бот напишет, когда потрачено 80% и 100%.
      </p>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 py-2 pl-3 pr-2">
            <span className="text-xl" aria-hidden>{item.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{item.name}</span>
              <span className="block truncate text-[12px] text-muted">
                {item.averageSpent > 0 ? `в среднем ${formatMoney(item.averageSpent)} в месяц` : item.spent > 0 ? `в этом месяце ${formatMoney(item.spent)}` : "трат пока не было"}
              </span>
            </span>
            <input
              value={values[item.id] ?? ""}
              onChange={event => setValues(v => ({ ...v, [item.id]: event.target.value }))}
              inputMode="decimal"
              placeholder="—"
              aria-label={`Лимит «${item.name}», ₸`}
              className="tabular h-10 w-28 shrink-0 rounded-xl bg-surface px-3 text-right text-[16px] text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
            />
          </label>
        ))}
      </div>
      {error && <p className="text-center text-[14px] font-medium text-negative">{error}</p>}
      <Button size="lg" className="w-full" loading={pending} onClick={submit}>Сохранить</Button>
    </div>
  );
}
